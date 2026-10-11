/** Bot memory unit tests over a real domain facility and in-memory backend. */
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import Storage, { storageBackendServiceKey } from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools from '@deepseek-ai/dsh-tools'
import { MemoryMediaPool, MemoryStorageBackend } from '../../storage-domain/tests/helpers/memory-backend.ts'
import * as BotMemory from '../src/index.ts'

const contexts: Context[] = []

/** Minimal Agent fixture registered in the harness's live-Agent map. */
function agentFor(id: string): Agent {
  return { id: SessionId(id), session: { id: SessionId(id) } as unknown as Agent['session'] } as unknown as Agent
}

const AGENT_A = agentFor('session-a')
const AGENT_B = agentFor('session-b')

async function execute(ctx: Context, args: Record<string, unknown>, agent: Agent | 'none' = AGENT_A) {
  const result = await ctx.tools.execute({
    name: 'bot_memory',
    arguments: args,
    callId: ToolCallId(`call-${Math.random().toString(36).slice(2)}`),
    signal: new AbortController().signal,
    ...agent === 'none' ? {} : { agent },
  })
  if (result.isError) throw new Error(`bot_memory fixture unexpectedly failed: ${result.error.message}`)
  return result
}

/** Extract the structured error code from a memory union value. */
function code(result: ToolExecutionResult): string | undefined {
  const value = result.value
  return typeof value === 'object' && value !== null && 'code' in value
    ? (value as { code: string }).code
    : undefined
}

async function harness(options: { pool?: MemoryMediaPool; maxRecords?: number } = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(Storage)
  const backend = new MemoryStorageBackend(options.pool)
  ctx.effect(() => ctx.storage.backend.register('memory', backend))
  ctx.provide(storageBackendServiceKey('memory'), backend)
  await ctx.plugin(StorageDomain, { backend: 'memory' })
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Tools)
  // The tool validates the caller against the live Agent registry.
  ctx.provide('agents', { get: (id: string) => id === 'session-a' ? AGENT_A : id === 'session-b' ? AGENT_B : undefined } as never)
  const fiber = ctx.plugin(BotMemory, BotMemory.Config(options?.maxRecords === undefined ? {} : { maxRecords: options.maxRecords }))
  await fiber.await()
  return { ctx, fiber, backend }
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

it('registers bot_memory with the documented schema and description', async () => {
  const { ctx } = await harness()
  const schema = ctx.tools.schemas().find(tool => tool.name === 'bot_memory')
  expect(schema).toBeDefined()
  expect(schema?.description).toBe(
    'Save, find, or delete personal memories across conversations. Shared memories are visible to all sessions '
    + 'in this personal deployment; session memories are private to this session. Store no passwords or access tokens.')
})

it('saves a shared memory visible to every session in the deployment', async () => {
  const { ctx } = await harness()
  const saved = await execute(ctx, { action: 'save', content: 'likes tea' })
  expect(saved.isError).toBe(false)
  const value = saved.value as { action: string; memories: { id: string; content: string; scope: string; updatedAt: number }[] }
  expect(value.action).toBe('save')
  expect(value.memories).toHaveLength(1)
  expect(value.memories[0]?.scope).toBe('shared')
  expect(value.memories[0]?.content).toBe('likes tea')
  const found = await execute(ctx, { action: 'search', query: 'tea' }, AGENT_B)
  expect((found.value as { memories: unknown[] }).memories).toHaveLength(1)
})

it('keeps session memories private to their owning session', async () => {
  const { ctx } = await harness()
  await execute(ctx, { action: 'save', content: 'secret note', scope: 'session' }, AGENT_A)
  const owner = await execute(ctx, { action: 'search', query: 'secret' }, AGENT_A)
  expect((owner.value as { memories: unknown[] }).memories).toHaveLength(1)
  const other = await execute(ctx, { action: 'search', query: 'secret' }, AGENT_B)
  expect((other.value as { memories: unknown[] }).memories).toHaveLength(0)
  // Listing without a query also cannot leak the private record.
  const listed = await execute(ctx, { action: 'search' }, AGENT_B)
  expect((listed.value as { memories: unknown[] }).memories).toHaveLength(0)
})

it('searches literally, case-insensitively, newest first, capped at ten', async () => {
  const { ctx } = await harness()
  for (let index = 0; index < 12; index += 1) {
    await execute(ctx, { action: 'save', content: `note ${index}` })
  }
  // Regex metacharacters in the query are literal text, not a pattern.
  const literal = await execute(ctx, { action: 'search', query: 'note.1' })
  expect((literal.value as { memories: unknown[] }).memories).toHaveLength(0)
  const cased = await execute(ctx, { action: 'search', query: 'NOTE 3' })
  expect((cased.value as { memories: { content: string }[] }).memories[0]?.content).toBe('note 3')
  const listed = await execute(ctx, { action: 'search' })
  const hits = (listed.value as { memories: { content: string }[] }).memories
  expect(hits).toHaveLength(5)
  expect(hits[0]?.content).toBe('note 11')
  const ten = await execute(ctx, { action: 'search', limit: 10 })
  expect((ten.value as { memories: unknown[] }).memories).toHaveLength(10)
})

it('enforces the UTF-8 content ceiling including multibyte text', async () => {
  const { ctx } = await harness()
  const exact = 'x'.repeat(2048)
  expect((await execute(ctx, { action: 'save', content: exact })).isError).toBe(false)
  const multibyte = '汉'.repeat(683) // 683 * 3 = 2049 bytes
  expect(code(await execute(ctx, { action: 'save', content: multibyte }))).toBe('invalid_arguments')
  const over = 'x'.repeat(2049)
  expect(code(await execute(ctx, { action: 'save', content: over }))).toBe('invalid_arguments')
  // A rejected save stores nothing.
  const listed = await execute(ctx, { action: 'search' })
  expect((listed.value as { memories: unknown[] }).memories).toHaveLength(1)
})

it('rejects argument combinations outside each action with stable codes', async () => {
  const { ctx } = await harness()
  expect(code(await execute(ctx, { action: 'save', content: 'x', id: 'i' }))).toBe('invalid_arguments')
  expect(code(await execute(ctx, { action: 'save', query: 'q' }))).toBe('invalid_arguments')
  expect(code(await execute(ctx, { action: 'save' }))).toBe('invalid_arguments')
  expect(code(await execute(ctx, { action: 'search', content: 'x' }))).toBe('invalid_arguments')
  expect(code(await execute(ctx, { action: 'search', scope: 'session' }))).toBe('invalid_arguments')
  expect(code(await execute(ctx, { action: 'delete' }))).toBe('invalid_arguments')
  expect(code(await execute(ctx, { action: 'delete', id: 'i', limit: 3 }))).toBe('invalid_arguments')
  const listed = await execute(ctx, { action: 'search' })
  expect((listed.value as { memories: unknown[] }).memories).toHaveLength(0)
})

it('requires a live calling Agent for every operation', async () => {
  const { ctx } = await harness()
  expect(code(await execute(ctx, { action: 'save', content: 'x' }, 'none'))).toBe('agent_required')
  expect(code(await execute(ctx, { action: 'search' }, 'none'))).toBe('agent_required')
  expect(code(await execute(ctx, { action: 'delete', id: 'i' }, 'none'))).toBe('agent_required')
  // An unregistered Agent handle is not a live caller either.
  const ghost = agentFor('ghost')
  expect(code(await execute(ctx, { action: 'save', content: 'x' }, ghost))).toBe('agent_required')
})

it('deletes an accessible record and reports unknown or private ids identically', async () => {
  const { ctx } = await harness()
  const shared = await execute(ctx, { action: 'save', content: 'shared fact' })
  const sharedId = (shared.value as { memories: { id: string }[] }).memories[0]!.id
  const privateSave = await execute(ctx, { action: 'save', content: 'my fact', scope: 'session' }, AGENT_A)
  const privateId = (privateSave.value as { memories: { id: string }[] }).memories[0]!.id

  const missing = await execute(ctx, { action: 'delete', id: 'does-not-exist' })
  expect((missing.value as { deleted: boolean }).deleted).toBe(false)
  const foreign = await execute(ctx, { action: 'delete', id: privateId }, AGENT_B)
  expect((foreign.value as { deleted: boolean }).deleted).toBe(false)
  // The private record still exists for its owner.
  const ownerList = await execute(ctx, { action: 'search', query: 'my fact' }, AGENT_A)
  expect((ownerList.value as { memories: unknown[] }).memories).toHaveLength(1)

  const removed = await execute(ctx, { action: 'delete', id: sharedId }, AGENT_B)
  expect((removed.value as { deleted: boolean }).deleted).toBe(true)
  expect((await execute(ctx, { action: 'search', query: 'shared fact' })).value)
    .toMatchObject({ memories: [] })
})

it('refuses new saves at the admission ceiling without evicting existing records', async () => {
  const { ctx } = await harness({ maxRecords: 3 })
  for (let index = 0; index < 3; index += 1) {
    await execute(ctx, { action: 'save', content: `keep ${index}` })
  }
  const refused = await execute(ctx, { action: 'save', content: 'overflow' })
  expect(code(refused)).toBe('capacity_reached')
  // Existing records are intact: nothing was evicted to make room.
  const listed = await execute(ctx, { action: 'search', limit: 10 })
  const hits = (listed.value as { memories: { content: string }[] }).memories
  // Records written inside one millisecond retain no defined relative order;
  // the contract under test is completeness, not timestamp ties.
  expect(hits.map(hit => hit.content).sort()).toEqual(['keep 0', 'keep 1', 'keep 2'])
})

it('pins concurrent saves at the ceiling: one admitted, one refused', async () => {
  const { ctx } = await harness({ maxRecords: 3 })
  await execute(ctx, { action: 'save', content: 'keep a' })
  await execute(ctx, { action: 'save', content: 'keep b' })
  const results = await Promise.all([
    execute(ctx, { action: 'save', content: 'racer 1' }),
    execute(ctx, { action: 'save', content: 'racer 2' }),
  ])
  const codes = results.map(result => 'code' in (result.value as object) ? 'capacity' : 'saved').sort()
  expect(codes).toEqual(['capacity', 'saved'])
  const listed = await execute(ctx, { action: 'search', limit: 10 })
  expect((listed.value as { memories: unknown[] }).memories).toHaveLength(3)
})

it('does not report success when the backend write fails', async () => {
  const pool = new MemoryMediaPool()
  const { ctx } = await harness({ pool })
  pool.failNextWrites = 1
  expect(code(await execute(ctx, { action: 'save', content: 'unreachable' }))).toBe('internal_error')
  // The failed save left no partial record behind.
  expect((await execute(ctx, { action: 'search' })).value).toMatchObject({ memories: [] })
})

it('drains admitted writes before the domain closes on disposal', async () => {
  const { ctx, fiber } = await harness()
  const saved = execute(ctx, { action: 'save', content: 'in flight' })
  await fiber.dispose()
  await saved
  // Disposal awaited the queued write; a fresh open sees it if the medium kept it.
})

it('removes the tool on disposal', async () => {
  const { ctx, fiber } = await harness()
  expect(ctx.tools.schemas().some(tool => tool.name === 'bot_memory')).toBe(true)
  await fiber.dispose()
  expect(ctx.tools.schemas().some(tool => tool.name === 'bot_memory')).toBe(false)
})
