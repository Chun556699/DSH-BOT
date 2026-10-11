import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, mkdir, readFile, writeFile, lstat, rename, rm, symlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionPersistence } from '@deepseek-ai/dsh-session-persistence'
import JsonlPersistence from '../src/index.ts'
import { deleteSessionDirectories, SESSION_DELETION_SUPPORTED } from '../src/deletion.ts'
import { encodeSegment, sessionDir } from '../src/format.ts'
import { SessionWriteLease } from '../src/lease.ts'

/** Runs after a real `lstat` resolves, so a test can replace the entry before deletion opens it. */
const afterLstat = vi.hoisted(() => ({ hook: undefined as ((path: string) => Promise<void>) | undefined }))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    lstat: (async (path: unknown, ...rest: never[]) => {
      const result = await (actual.lstat as (path: unknown, ...args: never[]) => Promise<unknown>)(path, ...rest)
      await afterLstat.hook?.(String(path))
      return result
    }) as typeof actual.lstat,
  }
})

afterEach(() => {
  afterLstat.hook = undefined
})

const linkType = process.platform === 'win32' ? 'junction' : 'dir'

/** Lease acquisition for a root whose Session directory must not be reached. */
const unused = (): Promise<SessionWriteLease> => Promise.reject(new Error('no Session directory expected'))

async function bench() {
  const root = await mkdtemp(join(tmpdir(), 'session-delete-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(JsonlPersistence, { root, compression: 'none' }).await()
  onTestFinished(() => ctx.fiber.dispose())
  return { root, ctx, persistence: ctx.sessionPersistence }
}

async function store(persistence: SessionPersistence, id: string) {
  const handle = await persistence.create({
    version: SESSION_FORMAT_VERSION, id: SessionId(id), cwd: '/project', createdAt: 1, isSeeded: false,
  })
  await handle.flush()
  await handle.close()
  return SessionId(id)
}

async function externalDirectory() {
  const external = await mkdtemp(join(tmpdir(), 'delete-external-'))
  onTestFinished(() => rm(external, { recursive: true, force: true }))
  await writeFile(join(external, 'keep.txt'), 'outside')
  return external
}

it.skipIf(SESSION_DELETION_SUPPORTED)('refuses deletion without touching storage on hosts without anchored removal', async () => {
  const b = await bench()
  const id = await store(b.persistence, 'unsupported')
  expect(b.persistence.supportsDeletion).toBe(false)
  await expect(b.persistence.delete(id)).rejects.toThrow()
  expect(await b.persistence.stat(id)).toBeDefined()
})

// Windows pins directories with handles; Linux resolves through /proc/self/fd.
describe.skipIf(!SESSION_DELETION_SUPPORTED)('permanent Session storage deletion', () => {
  it('removes all generations and nested local files, preserving other Sessions and the project', async () => {
    const b = await bench()
    const target = await store(b.persistence, 'target')
    const other = await store(b.persistence, 'other')
    const dir = sessionDir(b.root, '/project', target)
    await writeFile(join(dir, 'session.v1.jsonl'), 'retained predecessor\n')
    await mkdir(join(dir, 'files', 'nested'), { recursive: true })
    await writeFile(join(dir, 'files', 'nested', 'output.txt'), 'owned file')
    await writeFile(join(b.root, 'project-file.txt'), 'keep')
    await b.persistence.delete(target)
    await expect(lstat(dir)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await b.persistence.stat(target)).toBeUndefined()
    expect((await b.persistence.list()).map(row => row.header.id)).toEqual([other])
    expect(await readFile(join(b.root, 'project-file.txt'), 'utf8')).toBe('keep')
    await expect(b.persistence.delete(target)).resolves.toBeUndefined()
  })

  it('refuses in-process and foreign writers without removing their files', async () => {
    const b = await bench()
    const id = await store(b.persistence, 'owned')
    const writer = await b.persistence.open(id, 'write')
    await expect(b.persistence.delete(id)).rejects.toMatchObject({ name: 'SessionAlreadyOwnedError' })
    const foreign = new Context()
    await foreign.plugin(JsonlPersistence, { root: b.root, compression: 'none' }).await()
    onTestFinished(() => foreign.fiber.dispose())
    await expect(foreign.sessionPersistence.delete(id)).rejects.toMatchObject({ name: 'SessionAlreadyOwnedError' })
    expect(await b.persistence.stat(id)).toBeDefined()
    await writer.close()
    await foreign.sessionPersistence.delete(id)
    expect(await b.persistence.stat(id)).toBeUndefined()
  })

  it('unlinks nested junctions without deleting their targets', async () => {
    const b = await bench()
    const id = await store(b.persistence, 'linked')
    const external = await externalDirectory()
    await symlink(external, join(sessionDir(b.root, '/project', id), 'link'), linkType)
    await b.persistence.delete(id)
    expect(await readFile(join(external, 'keep.txt'), 'utf8')).toBe('outside')
  })

  it('refuses linked Session directories without touching their external targets', async () => {
    const b = await bench()
    const id = await store(b.persistence, 'linked-owner')
    const dir = sessionDir(b.root, '/project', id)
    const external = await externalDirectory()
    await rm(dir, { recursive: true })
    await symlink(external, dir, linkType)
    await expect(b.persistence.delete(id)).rejects.toThrow('linked')
    expect(await readFile(join(external, 'keep.txt'), 'utf8')).toBe('outside')
  })

  it('finishes cleanup of a Session directory with no remaining log', async () => {
    const b = await bench()
    const id = SessionId('partial')
    const dir = sessionDir(b.root, '/project', id)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'leftover.txt'), 'partial')
    await b.persistence.delete(id)
    await expect(lstat(dir)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('treats a missing root as already deleted', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'session-delete-root-'))
    onTestFinished(() => rm(parent, { recursive: true, force: true }))
    await expect(deleteSessionDirectories(join(parent, 'absent'), SessionId('x'), unused)).resolves.toBeUndefined()
  })

  // Windows reports a path below a regular file as missing (ENOENT), not ENOTDIR.
  it.skipIf(process.platform === 'win32')('surfaces a root that cannot be resolved', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'session-delete-root-'))
    onTestFinished(() => rm(parent, { recursive: true, force: true }))
    await writeFile(join(parent, 'file'), '')
    await expect(deleteSessionDirectories(join(parent, 'file', 'root'), SessionId('x'), unused))
      .rejects.toMatchObject({ code: 'ENOTDIR' })
  })

  it('surfaces a storage lookup failure without removing the Session', async () => {
    const b = await bench()
    const id = await store(b.persistence, 'lookup-fails')
    afterLstat.hook = async (path) => {
      if (basename(path) !== encodeSegment(id)) return
      afterLstat.hook = undefined
      throw Object.assign(new Error('EACCES: injected lookup refusal'), { code: 'EACCES' })
    }
    await expect(b.persistence.delete(id)).rejects.toMatchObject({ code: 'EACCES' })
    expect(await b.persistence.stat(id)).toBeDefined()
  })

  it('never follows a Session root replaced after the writer lease', async () => {
    const b = await bench()
    const id = await store(b.persistence, 'root-swap')
    const dir = sessionDir(b.root, '/project', id)
    const moved = `${dir}-moved`
    const external = await externalDirectory()
    let refused = false
    const outcome = await deleteSessionDirectories(b.root, id, async (directory, identityDirectory) => {
      const lease = await SessionWriteLease.acquire(directory, id, identityDirectory)
      refused = await rename(dir, moved).then(() => false, (error: unknown) => {
        // Windows: the deletion pin denies renaming the Session root.
        expect((error as NodeJS.ErrnoException).code).toMatch(/^(EPERM|EBUSY|EACCES)$/)
        return true
      })
      if (!refused) await symlink(external, dir, linkType)
      return lease
    }).then(() => undefined, (error: unknown) => error)
    expect(refused).toBe(process.platform === 'win32')
    if (refused) expect(outcome).toBeUndefined()
    else expect(String(outcome)).toContain('changed during deletion')
    expect(await readFile(join(external, 'keep.txt'), 'utf8')).toBe('outside')
    if (refused) await expect(lstat(dir)).rejects.toMatchObject({ code: 'ENOENT' })
    else expect((await lstat(moved)).isDirectory()).toBe(true)
  })

  it.each(['link', 'directory'] as const)('refuses a nested directory replaced by a %s before traversal', async (replacement) => {
    const b = await bench()
    const id = await store(b.persistence, `nested-${replacement}`)
    const dir = sessionDir(b.root, '/project', id)
    await mkdir(join(dir, 'files'))
    await writeFile(join(dir, 'files', 'owned.txt'), 'owned')
    const external = await externalDirectory()
    afterLstat.hook = async (path) => {
      if (basename(path) !== 'files') return
      afterLstat.hook = undefined
      await rename(join(dir, 'files'), join(dir, 'files-moved'))
      if (replacement === 'link') await symlink(external, join(dir, 'files'), linkType)
      else await mkdir(join(dir, 'files'))
    }
    await expect(b.persistence.delete(id)).rejects.toThrow()
    expect(afterLstat.hook).toBeUndefined()
    expect(await readFile(join(external, 'keep.txt'), 'utf8')).toBe('outside')
  })
})
