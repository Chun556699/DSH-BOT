/**
 * Session tree removal through stable directory identities. Linux addresses
 * each opened directory through `/proc/self/fd`, so a replaced pathname cannot
 * redirect later operations. Windows directory handles deny rename and
 * replacement of the pinned directories while their descendants are removed.
 * Other hosts lack a Node descriptor-relative namespace and do not support deletion.
 * @module dsh-session-persistence-jsonl/deletion
 */

import { constants, type BigIntStats } from 'node:fs'
import { lstat, open, readdir, realpath, rmdir, unlink } from 'node:fs/promises'
import { join, parse, relative, sep } from 'node:path'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { encodeSegment } from './format.ts'
import { LEASE_FILENAME, type SessionWriteLease } from './lease.ts'
import { acquireDirectoryHandleWin32, releaseDirectoryHandleWin32 } from './win32.ts'

/**
 * Whether this host can remove Session trees without resolving mutable paths.
 * The browser worker reports Linux but lacks directory open flags, so it is excluded.
 */
export const SESSION_DELETION_SUPPORTED = process.platform === 'win32'
  || (process.platform === 'linux' && typeof constants.O_DIRECTORY === 'number' && typeof constants.O_NOFOLLOW === 'number')

/** An opened directory, not a later resolution of its mutable pathname. */
interface Directory {
  /** Path whose resolution reaches the opened directory while it stays open. */
  readonly path: string
  readonly identity: { readonly dev: bigint; readonly ino: bigint }
  close(): Promise<void>
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function assertIdentity(actual: { dev: bigint; ino: bigint }, expected: { dev: bigint; ino: bigint }): void {
  if (actual.dev !== expected.dev || actual.ino !== expected.ino) {
    throw new Error('Session storage directory changed during deletion')
  }
}

/** Open the final component itself and require the identity the caller observed. */
async function openDirectory(path: string, expected: BigIntStats): Promise<Directory> {
  if (expected.isSymbolicLink() || !expected.isDirectory()) {
    throw new Error(`refusing to delete a linked or non-directory storage entry: ${path}`)
  }
  /* v8 ignore start -- native Windows deletion tests exercise directory pins; Linux covers the descriptor peer */
  if (process.platform === 'win32') {
    const pin = await acquireDirectoryHandleWin32(path)
    try {
      assertIdentity(pin, expected)
    } catch (error: unknown) {
      await releaseDirectoryHandleWin32(pin.handle)
      throw error
    }
    return { path, identity: pin, close: () => releaseDirectoryHandleWin32(pin.handle) }
  }
  /* v8 ignore stop */
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  try {
    const identity = await handle.stat({ bigint: true })
    assertIdentity(identity, expected)
    const anchored = `/proc/self/fd/${handle.fd}`
    // Fail closed when the descriptor namespace is unavailable; never fall back to paths.
    // String concatenation keeps the trailing `.` that path joining would remove.
    assertIdentity(await lstat(`${anchored}/.`, { bigint: true }), identity)
    return { path: anchored, identity, close: () => handle.close() }
  } catch (error: unknown) {
    await handle.close()
    throw error
  }
}

/** Close every directory, then report the first failure, so no Windows pin outlives deletion. */
async function closeDirectories(directories: readonly Directory[]): Promise<void> {
  const closed = await Promise.allSettled(directories.map(directory => directory.close()))
  const failure = closed.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  /* v8 ignore next -- closing an open directory handle fails only on an external fault */
  if (failure !== undefined) throw failure.reason
}

/** Remove a directory's contents. Every operation resolves through the held parent. */
async function removeContents(directory: Directory, sessionRoot = false): Promise<void> {
  for (const name of await readdir(directory.path)) {
    // A POSIX writer locks this inode. Keep it until every log has gone so
    // another write-open cannot acquire a replacement lock over a surviving log.
    if (sessionRoot && process.platform !== 'win32' && name === LEASE_FILENAME) continue
    const path = join(directory.path, name)
    const entry = await lstat(path, { bigint: true })
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      await unlink(path)
      continue
    }
    const child = await openDirectory(path, entry)
    try {
      await removeContents(child)
      assertIdentity(await lstat(path, { bigint: true }), child.identity)
    } finally {
      await child.close()
    }
    // Non-recursive removal of an empty entry cannot reach a replacement link's target.
    await rmdir(path)
  }
  if (sessionRoot && process.platform !== 'win32') await unlink(join(directory.path, LEASE_FILENAME))
}

/** Remove one project's directory for the encoded Session id, if present. */
async function removeSessionDirectory(
  project: Directory,
  encoded: string,
  acquireLease: (directory: string) => Promise<SessionWriteLease>,
): Promise<void> {
  const path = join(project.path, encoded)
  let entry: BigIntStats
  try {
    entry = await lstat(path, { bigint: true })
  } catch (error: unknown) {
    if (isMissing(error)) return
    throw error
  }
  const directory = await openDirectory(path, entry)
  let lease: SessionWriteLease | undefined
  try {
    try {
      lease = await acquireLease(directory.path)
      assertIdentity(await lstat(path, { bigint: true }), directory.identity)
      await removeContents(directory, true)
      assertIdentity(await lstat(path, { bigint: true }), directory.identity)
    } finally {
      // Windows refuses to remove a directory while its own pin is open.
      await directory.close()
    }
    await rmdir(path)
  } finally {
    await lease?.release()
  }
}

/**
 * Remove every storage directory for one encoded Session id while holding its
 * writer lease. A missing root or directory is a no-op. A linked entry, an
 * identity change, or an unavailable descriptor namespace rejects. A rejection
 * can leave partial cleanup; removal never follows a replacement link.
 * Callers must check {@link SESSION_DELETION_SUPPORTED} first.
 * @param root - configured persistence root.
 * @param id - Session whose owned storage is removed.
 * @param acquireLease - provider-owned writer acquisition. It receives the
 *   anchored directory path and the configured-root spelling of the same directory.
 */
export async function deleteSessionDirectories(
  root: string,
  id: SessionId,
  acquireLease: (directory: string, identityDirectory: string) => Promise<SessionWriteLease>,
): Promise<void> {
  let canonical: string
  try {
    canonical = await realpath(root)
  } catch (error: unknown) {
    if (isMissing(error)) return
    throw error
  }
  const expectedRoot = await lstat(canonical, { bigint: true })
  const encoded = encodeSegment(id)
  const held: Directory[] = []
  try {
    // Open each ancestor from its held parent, so no ancestor replacement can
    // redirect a later operation. Windows pins deny their rename.
    const volume = parse(canonical).root
    let current = await openDirectory(volume, await lstat(volume, { bigint: true }))
    held.push(current)
    for (const segment of relative(volume, canonical).split(sep).filter(Boolean)) {
      const path = join(current.path, segment)
      current = await openDirectory(path, await lstat(path, { bigint: true }))
      held.push(current)
    }
    assertIdentity(current.identity, expectedRoot)
    for (const project of await readdir(current.path, { withFileTypes: true })) {
      if (!project.isDirectory()) continue
      const path = join(current.path, project.name)
      const directory = await openDirectory(path, await lstat(path, { bigint: true }))
      try {
        await removeSessionDirectory(directory, encoded, anchored =>
          acquireLease(anchored, join(root, project.name, encoded)))
      } finally {
        await directory.close()
      }
    }
  } finally {
    await closeDirectories(held)
  }
}
