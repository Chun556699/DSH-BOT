/** Permanent deletion through the Session Remote, with real JSONL storage. */
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, mkdir, lstat, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { sessionDir } from '@deepseek-ai/dsh-session-persistence-jsonl/src/format.ts'
import { SESSION_DELETION_SUPPORTED } from '@deepseek-ai/dsh-session-persistence-jsonl/src/deletion.ts'
import { createSessionTestRemote } from './test-remote.ts'

async function bench() {
  const root = await mkdtemp(join(tmpdir(), 'session-delete-api-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const ctx = new Context()
  await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions'), compression: 'none' }).await()
  await ctx.plugin(SessionStore).await()
  await ctx.plugin(AgentRegistry).await()
  onTestFinished(() => ctx.fiber.dispose())
  const forget = vi.fn<(id: SessionId) => Promise<void>>(async () => undefined)
  ctx.provide('workspaceRegistry', { forgetSession: forget, isSessionArchived: () => false } as never)
  const remote = createSessionTestRemote(ctx, {
    cwd: root, defaultModelSelection: () => ({ provider: 'fixture', model: 'fixture' }),
  })
  const removed = vi.fn()
  ctx.on('api-session/removed', removed)
  const store = async (name: string) => {
    const id = SessionId(name)
    const handle = await ctx.sessionPersistence.create({
      version: SESSION_FORMAT_VERSION, id, cwd: root, createdAt: 1, isSeeded: false,
    })
    await handle.flush()
    await handle.close()
    return id
  }
  return { ctx, root, remote, forget, removed, store }
}

// JSONL deletion requires Windows directory pins or Linux descriptor paths; other hosts refuse it.
describe.skipIf(!SESSION_DELETION_SUPPORTED)('Session Remote permanent deletion', () => {
  it('removes Session files before membership and catalog removal, preserving project files and other Sessions', async () => {
    const b = await bench()
    const id = await b.store('deleted')
    const other = await b.store('preserved')
    const dir = sessionDir(join(b.root, 'sessions'), b.root, id)
    await mkdir(join(dir, 'files'))
    await writeFile(join(dir, 'files', 'output.txt'), 'local')
    await writeFile(join(b.root, 'project.txt'), 'keep')
    b.forget.mockImplementation(async () => {
      await expect(lstat(dir)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(b.removed).not.toHaveBeenCalled()
    })
    expect(await b.remote.delete({ sessionId: id })).toEqual({ ok: true, value: { deleted: true } })
    expect(b.forget).toHaveBeenCalledWith(id)
    expect(b.removed).toHaveBeenCalledWith(id)
    expect(await b.ctx.sessionPersistence.stat(id)).toBeUndefined()
    expect(await b.ctx.sessionPersistence.stat(other)).toBeDefined()
    expect(await readFile(join(b.root, 'project.txt'), 'utf8')).toBe('keep')
  })

  it('refuses running work before touching storage or memberships', async () => {
    const b = await bench()
    const id = await b.store('active')
    b.ctx.on('workspace/session-activity', async (_request, next) => [
      ...await next(), { kind: 'turn' },
    ])
    expect(await b.remote.delete({ sessionId: id })).toMatchObject({
      ok: false, error: { code: 'session/delete-active' },
    })
    expect(await b.ctx.sessionPersistence.stat(id)).toBeDefined()
    expect(b.forget).not.toHaveBeenCalled()
    expect(b.removed).not.toHaveBeenCalled()
  })

  it('refuses an attached Session owned outside the API', async () => {
    const b = await bench()
    const id = await b.store('foreign')
    b.ctx.sessions.create(id)
    expect(await b.remote.delete({ sessionId: id })).toMatchObject({
      ok: false, error: { code: 'session/writer-held' },
    })
    expect(await b.ctx.sessionPersistence.stat(id)).toBeDefined()
    expect(b.removed).not.toHaveBeenCalled()
  })

  it('reports write contention and allows deletion after the writer closes', async () => {
    const b = await bench()
    const id = await b.store('writer')
    const handle = await b.ctx.sessionPersistence.open(id, 'write')
    expect(await b.remote.delete({ sessionId: id })).toMatchObject({
      ok: false, error: { code: 'session/writer-held' },
    })
    expect(b.forget).not.toHaveBeenCalled()
    expect(b.removed).not.toHaveBeenCalled()
    await handle.close()
    expect(await b.remote.delete({ sessionId: id })).toMatchObject({ ok: true })
  })

  it('reports partial cleanup without a removal event and completes memberships on retry', async () => {
    const b = await bench()
    const id = await b.store('retry')
    b.forget.mockRejectedValueOnce(new Error('membership write failed'))
    expect(await b.remote.delete({ sessionId: id })).toMatchObject({
      ok: false, error: { code: 'session/delete-failed' },
    })
    expect(await b.ctx.sessionPersistence.stat(id)).toBeUndefined()
    expect(b.removed).not.toHaveBeenCalled()
    expect(await b.remote.delete({ sessionId: id })).toMatchObject({ ok: true })
    expect(b.removed).toHaveBeenCalledWith(id)
  })

  it('refuses providers without deletion support', async () => {
    const b = await bench()
    const id = SessionId('missing')
    Object.defineProperty(b.ctx.sessionPersistence, 'supportsDeletion', { value: false })
    expect(await b.remote.delete({ sessionId: id })).toMatchObject({
      ok: false, error: { code: 'session/delete-unsupported' },
    })
    expect(b.forget).not.toHaveBeenCalled()
  })

  it('permits an already missing identity', async () => {
    const b = await bench()
    expect(await b.remote.delete({ sessionId: SessionId('missing') })).toMatchObject({ ok: true })
  })
})
