/**
 * Cross-process write-ownership lock for one session's artifact directory,
 * held for the whole life of a write handle. The arbiter is the kernel:
 * POSIX takes a non-blocking `flock(2)` via native system support on `session.lock`
 * beside the log, and Windows holds a named kernel semaphore derived from
 * that path — never a file lock or handle, so readers, searches, and
 * directory removal proceed freely while the lock is held. Contention maps
 * to `SessionAlreadyOwnedError`; the kernel releases the lock when the
 * holder's descriptor or last object handle closes, including on any process
 * death, so a crashed holder never blocks a successor. A live but wedged
 * holder keeps the lock until its process exits: there is deliberately no
 * expiry that could expropriate a stalled writer whose resumed appends would
 * tear the log.
 * A POSIX lock names an inode, not a path, so after locking the holder
 * verifies the locked inode is still the file at the lock path and retries
 * otherwise: an unlinked-and-recreated lock file carries a fresh inode, and
 * a lock on the orphaned one proves nothing. Removing a live session's lock
 * file therefore forfeits exclusion on POSIX. Permanent Session deletion
 * removes it only after every log is gone; Windows has no lock file at all.
 * Acquisition never truncates or writes the lock file, and it refuses a lock
 * path that is a link, a non-regular file, or a file with several hard links.
 * Readers never touch the lock.
 * The lock is acquired at write-open of an existing artifact and, for a
 * created session, only right before its first materializing write — an
 * unmaterialized session has no filesystem footprint. Release never removes
 * the POSIX lock file: every acquired lock belongs to a materialized or
 * materializing session, and the surviving file keeps the stable inode later
 * lockers verify against. The browser worker stubs the native flock entry to
 * immediate success: it is single-process, so the in-process write claim
 * already excludes every writer.
 * @module @deepseek-ai/dsh-session-persistence-jsonl/lease
 */

import type { BigIntStats } from 'node:fs'
import { mkdir, open, lstat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import { tryLockExclusive } from '@deepseek-ai/node-addon-system/flock'
import { SessionAlreadyOwnedError } from '@deepseek-ai/dsh-session-persistence'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { acquireLockHandleWin32, releaseLockHandleWin32 } from './win32.ts'

/** Base name of the kernel lock file inside a session's directory. */
export const LEASE_FILENAME = 'session.lock'

/** The held kernel lock: a POSIX descriptor or a Win32 semaphore handle. */
type HeldLock =
  | { readonly kind: 'posix'; readonly handle: FileHandle }
  | { readonly kind: 'win32'; readonly handle: number }

/** Whether a flock failure means another descriptor holds the lock. */
function isLockContention(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code
  // flock(2) reports EAGAIN; some libcs spell it EWOULDBLOCK.
  return code === 'EAGAIN' || code === 'EWOULDBLOCK'
}

/** A lock must be a regular, singly linked file, never an alias to another file. */
function assertLockFile(info: BigIntStats, path: string): void {
  if (!info.isFile() || info.nlink > 1n) throw new Error(`refusing unsafe Session lock file: ${path}`)
}

/**
 * Open the lock file without truncating or writing it, so an aliased path
 * cannot damage the file it names before verification refuses it.
 * @returns the descriptor, or `undefined` when a concurrent creator won and the caller should retry.
 */
async function openLockFile(path: string): Promise<FileHandle | undefined> {
  try {
    // flock(2) needs no write access.
    return await open(path, 'r')
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error
  }
  try {
    return await open(path, 'wx', 0o600)
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException | null)?.code !== 'EEXIST') throw error
  }
  // Both opens fail for a dangling link; refuse it rather than reporting contention.
  assertLockFile(await lstat(path, { bigint: true }), path)
  /* v8 ignore next -- only a concurrent creator publishing the lock between the two opens reaches this */
  return undefined
}

/**
 * One held write lock. Constructed only by {@link SessionWriteLease.acquire};
 * `release` closes the descriptor or handle, which is what releases the lock.
 */
export class SessionWriteLease {
  private released = false

  private constructor(private readonly held: HeldLock) {}

  /**
   * Acquire the session directory's kernel write lock.
   * @param dir - the session's artifact directory (created if absent).
   * @param id - the session the lock guards, for error identities.
   * @param identityDir - the configured-root spelling of `dir`, which names the Windows semaphore when `dir` is anchored.
   * @returns the held lock.
   * @throws {SessionAlreadyOwnedError} while another holder keeps the lock.
   */
  static async acquire(dir: string, id: SessionId, identityDir = dir): Promise<SessionWriteLease> {
    const path = join(dir, LEASE_FILENAME)
    // Owner-only like materializePosix's directories: the lock may create the
    // session directory first, and both creators must agree on the mode.
    await mkdir(dir, { recursive: true, mode: 0o700 })
    /* v8 ignore start -- native Windows coverage exercises this platform branch; Linux covers the POSIX peer */
    if (process.platform === 'win32') {
      let handle: number
      try {
        handle = await acquireLockHandleWin32(join(identityDir, LEASE_FILENAME))
      } catch (error: unknown) {
        // Sharing violation: another handle already holds the write exclusion.
        if ((error as NodeJS.ErrnoException | null)?.code === 'EBUSY') throw new SessionAlreadyOwnedError(id)
        throw error
      }
      return new SessionWriteLease({ kind: 'win32', handle })
    }
    /* v8 ignore stop */
    // Bounded retry: locking an inode a releasing creator just unlinked (or a
    // recreated path) re-opens the fresh file; steady state needs one pass.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const handle = await openLockFile(path)
      /* v8 ignore next -- only a concurrent lock creator reaches this retry */
      if (handle === undefined) continue
      try {
        const held = await handle.stat({ bigint: true })
        assertLockFile(held, path)
        try {
          await tryLockExclusive(handle.fd)
        } catch (error: unknown) {
          if (isLockContention(error)) throw new SessionAlreadyOwnedError(id)
          throw error
        }
        const current = await lstat(path, { bigint: true }).catch((error: unknown) => {
          if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return undefined
          throw error
        })
        if (current !== undefined) assertLockFile(current, path)
        if (current !== undefined && current.ino === held.ino && current.dev === held.dev) {
          return new SessionWriteLease({ kind: 'posix', handle })
        }
      } catch (error: unknown) {
        await handle.close()
        throw error
      }
      // The locked inode is no longer the file at the lock path: start over
      // against whatever now stands there.
      await handle.close()
    }
    throw new SessionAlreadyOwnedError(id)
  }

  /**
   * Release the kernel lock by closing its descriptor or handle. The POSIX
   * lock file is not removed by release; retaining it preserves the stable
   * inode later lockers verify against while Session logs survive. Permanent
   * deletion removes it only after every log is gone. Idempotent.
   */
  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    /* v8 ignore start -- native Windows coverage exercises this platform branch; Linux covers the POSIX peer */
    if (this.held.kind === 'win32') {
      await releaseLockHandleWin32(this.held.handle)
      return
    }
    /* v8 ignore stop */
    await this.held.handle.close()
  }
}
