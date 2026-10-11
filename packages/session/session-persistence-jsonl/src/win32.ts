/**
 * Windows durable namespace helpers for the JSONL backend.
 *
 * POSIX publishes a newly-created log by creating a directory entry and then
 * fsyncing the parent directory. Windows does not expose that parent-directory
 * fsync contract through Node, so the Windows path uses the native durable
 * namespace primitive instead: create a staging object in the target directory
 * and publish it with `MoveFileExW(..., MOVEFILE_WRITE_THROUGH)` without
 * replacement or cross-volume copy fallback.
 *
 * @module dsh-session-persistence-jsonl/win32
 */

import { createHash } from 'node:crypto'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { join, parse, resolve, toNamespacedPath } from 'node:path'

type MoveFileExW = (existing: string, replacement: string, flags: number) => number
type CreateSemaphoreW = (security: null, initial: number, maximum: number, name: string) => number
type WaitForSingleObject = (handle: number, milliseconds: number) => number
type ReleaseSemaphore = (handle: number, count: number, previous: null) => number
type CloseHandle = (handle: number) => number
type GetLastError = () => number
type CreateFileW = (
  path: string, access: number, share: number, security: null, creation: number, flags: number, template: number,
) => number
type GetFileInformationByHandle = (handle: number, information: Buffer) => number

interface Win32Bindings {
  moveFileExW: MoveFileExW
  createSemaphoreW: CreateSemaphoreW
  waitForSingleObject: WaitForSingleObject
  releaseSemaphore: ReleaseSemaphore
  closeHandle: CloseHandle
  getLastError: GetLastError
  createFileW: CreateFileW
  getFileInformationByHandle: GetFileInformationByHandle
}

interface Win32ErrnoException extends NodeJS.ErrnoException {
  win32Code: number
  dest: string
}

const MOVEFILE_WRITE_THROUGH = 0x00000008
const WAIT_OBJECT_0 = 0
const WAIT_TIMEOUT = 0x00000102
const ERROR_FILE_NOT_FOUND = 2
const ERROR_PATH_NOT_FOUND = 3
const ERROR_ACCESS_DENIED = 5
const ERROR_NOT_SAME_DEVICE = 17
const ERROR_SHARING_VIOLATION = 32
const ERROR_FILE_EXISTS = 80
const ERROR_INVALID_NAME = 123
const ERROR_ALREADY_EXISTS = 183

let bindings: Win32Bindings | undefined

/** Load the small Win32 API lazily so non-Windows processes never load Koffi. */
async function win32(): Promise<Win32Bindings> {
  if (bindings !== undefined) return bindings
  const koffi = (await import('koffi')).default
  const kernel32 = koffi.load('kernel32.dll')
  bindings = {
    moveFileExW: kernel32.func('__stdcall', 'MoveFileExW', 'int', ['str16', 'str16', 'uint']) as MoveFileExW,
    createSemaphoreW: kernel32.func('__stdcall', 'CreateSemaphoreW', 'intptr', ['void*', 'int', 'int', 'str16']) as CreateSemaphoreW,
    waitForSingleObject: kernel32.func('__stdcall', 'WaitForSingleObject', 'uint', ['intptr', 'uint']) as WaitForSingleObject,
    releaseSemaphore: kernel32.func('__stdcall', 'ReleaseSemaphore', 'int', ['intptr', 'int', 'void*']) as ReleaseSemaphore,
    closeHandle: kernel32.func('__stdcall', 'CloseHandle', 'int', ['intptr']) as CloseHandle,
    getLastError: kernel32.func('__stdcall', 'GetLastError', 'uint', []) as GetLastError,
    createFileW: kernel32.func('__stdcall', 'CreateFileW', 'intptr',
      ['str16', 'uint', 'uint', 'void*', 'uint', 'uint', 'intptr']) as CreateFileW,
    getFileInformationByHandle: kernel32.func('__stdcall', 'GetFileInformationByHandle',
      'int', ['intptr', 'void*']) as GetFileInformationByHandle,
  }
  return bindings
}

function errnoCode(win32Code: number): string {
  switch (win32Code) {
    case ERROR_FILE_NOT_FOUND:
    case ERROR_PATH_NOT_FOUND:
      return 'ENOENT'
    case ERROR_ACCESS_DENIED:
      return 'EACCES'
    case ERROR_NOT_SAME_DEVICE:
      return 'EXDEV'
    case ERROR_SHARING_VIOLATION:
      return 'EBUSY'
    case ERROR_FILE_EXISTS:
    case ERROR_ALREADY_EXISTS:
      return 'EEXIST'
    case ERROR_INVALID_NAME:
      return 'EINVAL'
    default:
      return 'EIO'
  }
}

function win32Error(syscall: string, win32Code: number, path: string, dest: string): Win32ErrnoException {
  const code = errnoCode(win32Code)
  const error = new Error(`${syscall} ${code} (Win32 ${win32Code}): ${path} -> ${dest}`) as Win32ErrnoException
  error.code = code
  error.errno = win32Code
  error.syscall = syscall
  error.path = path
  error.dest = dest
  error.win32Code = win32Code
  return error
}

function isENOENT(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function isEEXIST(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === 'EEXIST'
}

async function assertDirectory(path: string): Promise<boolean> {
  try {
    // A bare drive root is already short, and Node rejects its extended-length
    // spelling as EISDIR. Descendants retain the namespace for long-path probes.
    const probe = path === parse(path).root ? path : toNamespacedPath(path)
    const info = await stat(probe)
    if (info.isDirectory()) return true
    const error = new Error(`path exists but is not a directory: ${path}`) as NodeJS.ErrnoException
    error.code = 'ENOTDIR'
    error.path = path
    throw error
  } catch (error) {
    if (isENOENT(error)) return false
    throw error
  }
}

/**
 * Publish `existing` at `replacement` with Windows write-through rename
 * semantics. The destination must not already exist; the move must stay within
 * the volume (no copy fallback flag is set).
 * @param existing - the synced staging path to move.
 * @param replacement - the final path, which must not already exist.
 */
export async function publishNewFileWin32(existing: string, replacement: string): Promise<void> {
  const api = await win32()
  const ok = api.moveFileExW(toNamespacedPath(existing), toNamespacedPath(replacement), MOVEFILE_WRITE_THROUGH)
  if (ok === 0) throw win32Error('MoveFileExW', api.getLastError(), existing, replacement)
}

/**
 * Acquire the session write lock as a named kernel semaphore (count 1) whose
 * name is derived from the canonical lock path. A kernel object never touches
 * the filesystem, so readers, searches, and directory removal proceed freely
 * while the lock is held; a second acquirer's zero-timeout wait times out
 * (`EBUSY`); and when the last handle closes — including on any process
 * death — the object is destroyed, so a successor's create starts fresh.
 * @param path - the lock file path the name is derived from (case-folded:
 *   Windows paths are case-insensitive).
 * @returns the open semaphore handle, released via {@link releaseLockHandleWin32}.
 */
export async function acquireLockHandleWin32(path: string): Promise<number> {
  const api = await win32()
  const name = `Local\\dsh-session-lock-${createHash('sha256').update(resolve(path).toLowerCase()).digest('hex')}`
  const handle = api.createSemaphoreW(null, 1, 1, name)
  if (handle === 0) throw win32Error('CreateSemaphoreW', api.getLastError(), path, name)
  const wait = api.waitForSingleObject(handle, 0)
  if (wait === WAIT_OBJECT_0) return handle
  api.closeHandle(handle)
  if (wait === WAIT_TIMEOUT) throw win32Error('WaitForSingleObject', ERROR_SHARING_VIOLATION, path, name)
  throw win32Error('WaitForSingleObject', api.getLastError(), path, name)
}

/**
 * Release a lock from {@link acquireLockHandleWin32}: restore the semaphore
 * count and close the handle (the object dies with its last handle).
 * @param handle - the open semaphore handle.
 */
export async function releaseLockHandleWin32(handle: number): Promise<void> {
  const api = await win32()
  const released = api.releaseSemaphore(handle, 1, null)
  const closed = api.closeHandle(handle)
  if (released === 0 || closed === 0) throw win32Error('ReleaseSemaphore', api.getLastError(), `handle:${handle}`, `handle:${handle}`)
}

/**
 * Pin a directory against rename and replacement without excluding reads,
 * writes, or deletion of its children. The final component is opened itself,
 * never a reparse target, so a caller comparing the returned identity with the
 * directory it observed rejects a replacement junction or symbolic link. The
 * caller must close the pin before removing the empty directory.
 * @param path - directory to open without following its final component.
 * @returns the handle and physical identity, released with {@link releaseDirectoryHandleWin32}.
 */
export async function acquireDirectoryHandleWin32(path: string): Promise<{ handle: number; dev: bigint; ino: bigint }> {
  const api = await win32()
  // LIST_DIRECTORY | READ_ATTRIBUTES; SHARE_READ | SHARE_WRITE (not SHARE_DELETE);
  // OPEN_EXISTING; BACKUP_SEMANTICS | OPEN_REPARSE_POINT. An attribute-only
  // open skips share-mode checks, so the pin requests list access to deny rename.
  const handle = api.createFileW(toNamespacedPath(path), 0x81, 0x3, null, 3, 0x02200000, 0)
  if (handle === -1) throw win32Error('CreateFileW', api.getLastError(), path, path)
  try {
    // BY_HANDLE_FILE_INFORMATION consists of thirteen DWORDs.
    const information = Buffer.alloc(52)
    if (api.getFileInformationByHandle(handle, information) === 0) {
      throw win32Error('GetFileInformationByHandle', api.getLastError(), path, path)
    }
    // FILE_ATTRIBUTE_DIRECTORY.
    if ((information.readUInt32LE(0) & 0x10) === 0) {
      throw new Error(`refusing to delete a non-directory storage entry: ${path}`)
    }
    return {
      handle,
      dev: BigInt(information.readUInt32LE(28)),
      ino: (BigInt(information.readUInt32LE(44)) << 32n) | BigInt(information.readUInt32LE(48)),
    }
  } catch (error: unknown) {
    api.closeHandle(handle)
    throw error
  }
}

/**
 * Close a directory pin. This does not remove the directory.
 * @param handle - handle returned by {@link acquireDirectoryHandleWin32}.
 */
export async function releaseDirectoryHandleWin32(handle: number): Promise<void> {
  const api = await win32()
  if (api.closeHandle(handle) === 0) {
    throw win32Error('CloseHandle', api.getLastError(), `handle:${handle}`, `handle:${handle}`)
  }
}

/**
 * Create `target` and its missing ancestors with durable Windows namespace
 * publication. Each missing directory is first created as a random staging
 * sibling, then moved to its final name with `MOVEFILE_WRITE_THROUGH`; races
 * with another creator are accepted only after verifying the winner is a
 * directory.
 * @param target - the absolute directory path to create durably when absent.
 */
export async function ensureDurableDirectoryWin32(target: string): Promise<void> {
  const absolute = resolve(target)
  const root = parse(absolute).root
  await assertDirectory(root)

  const segments = absolute.slice(root.length).split(/[\\/]+/).filter(part => part.length > 0)
  let current = root
  for (const segment of segments) {
    const next = join(current, segment)
    if (!await assertDirectory(next)) await createLeafDirectoryWin32(current, next)
    current = next
  }
}

async function createLeafDirectoryWin32(parent: string, target: string): Promise<void> {
  // Keep the staging component independent of the target basename so a legal
  // 255-byte target component does not make mkdtemp's sibling name too long.
  const staging = await mkdtemp(toNamespacedPath(join(parent, '.dsh-mkdir-')))
  try {
    await publishNewFileWin32(staging, target)
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    if (isEEXIST(error) && await assertDirectory(target)) return
    throw error
  }
}
