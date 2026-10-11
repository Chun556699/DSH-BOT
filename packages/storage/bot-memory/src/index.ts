/**
 * Bot memory plugin: one durable personal memory store plus the `bot_memory`
 * tool. Records live in the `bot_memory` storage domain (one private
 * deployment under DSH_HOME, per-record layout). Nothing is ever injected
 * into prompts — the model sees only memories it explicitly searched for —
 * and this store is not a secrets vault: the tool description tells the
 * model so.
 * @module @deepseek-ai/dsh-bot-memory
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-storage-domain'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import { botMemorySpec, MEMORY_CONTENT_MAX_BYTES } from './spec.ts'
import type { MemoryRecord } from './spec.ts'

/** Cordis identity for the Bot memory plugin. */
export const name = 'bot-memory'

/** Services the plugin consumes: storage domain facility, tool registry, and the Agent registry. */
export const inject = ['storageDomain', 'tools', 'agents']

/** Bot memory plugin configuration. */
export interface Config {
  /** Maximum records the store admits; a full store refuses new saves. */
  maxRecords: number
}

/** Validated Bot memory plugin configuration. */
export const Config = z.object({
  maxRecords: z.natural().min(1).max(10000).default(1000),
})

const TOOL_DESCRIPTION =
  'Save, find, or delete personal memories across conversations. Shared memories are visible to all sessions '
  + 'in this personal deployment; session memories are private to this session. Store no passwords or access tokens.'

const RECORD_VIEW_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: { type: 'string', required: true },
    content: { type: 'string', required: true },
    scope: { type: 'string', required: true, enum: ['shared', 'session'] },
    updatedAt: { type: 'integer', required: true },
  },
} as const

const CANONICAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    action: { type: 'string', required: true, enum: ['save', 'search', 'delete'] },
    memories: { type: 'array', required: true, items: RECORD_VIEW_SCHEMA },
    deleted: { type: 'boolean' },
  },
} as const

/** Build one exact two-field error schema while preserving its literal code. */
function errorSchema<const C extends string>(code: C) {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      code: { type: 'string', required: true, const: code },
      message: { type: 'string', required: true },
    },
  } as const
}

/** Stable error codes the model can tell apart without parsing prose. */
const OUTPUT_SCHEMA = {
  oneOf: [
    CANONICAL_SCHEMA,
    errorSchema('invalid_arguments'),
    errorSchema('capacity_reached'),
    errorSchema('agent_required'),
    errorSchema('internal_error'),
  ],
} as const

/** One structured rejection value. */
interface MemoryError {
  code: 'invalid_arguments' | 'capacity_reached' | 'agent_required' | 'internal_error'
  message: string
}

/** One record projected into the canonical output value. */
interface MemoryView {
  id: string
  content: string
  scope: 'shared' | 'session'
  updatedAt: number
}

/** Canonical output value for a successful call. */
interface MemoryResult {
  action: 'save' | 'search' | 'delete'
  memories: MemoryView[]
  deleted?: boolean
}

/** Deterministic model content for every value matching the output union. */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

/** Pure generic pending card. */
function present(title: string, kind: 'read' | 'other'): GenericCallView {
  return { card: 'generic', title, kind }
}

/** Stable error for failures not safe to expose. */
function internalError(): MemoryError {
  return { code: 'internal_error', message: 'The memory operation failed.' }
}

/** Record one memory in the canonical view form. */
function recordView(record: MemoryRecord): MemoryView {
  return { id: record.id, content: record.content, scope: record.scope, updatedAt: record.updatedAt }
}

/**
 * Mount the memory domain and register `bot_memory` in the mounting scope.
 * Mutation admission is serialized so concurrent saves cannot race the
 * `maxRecords` ceiling; the ceiling is admission-only — existing records
 * are never evicted, truncated, or cleared. Disposal drains queued
 * mutations before the domain closes.
 * @param ctx - Scope providing `storageDomain`, `tools`, and `agents`.
 * @param config - validated admission ceiling.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const domain = await ctx.storageDomain.open(botMemorySpec)
  const records = domain.table('records')
  let mutations = Promise.resolve()
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const run = mutations.then(operation)
    mutations = run.then(() => undefined, () => undefined)
    return run
  }
  ctx.effect(() => async () => {
    // Quiescence: writes already admitted drain (or abort) before the domain
    // closes; a put that outlives close would fail loud on a closed unit.
    await mutations
    await domain.close()
  }, 'bot-memory: domain')

  const dispose = ctx.tools.register(defineTool({
    name: 'bot_memory',
    description: TOOL_DESCRIPTION,
    parameters: {
      action: {
        type: 'string', required: true, enum: ['save', 'search', 'delete'],
        description: 'Operation to perform.',
      },
      content: {
        type: 'string',
        description: `Text to save, at most ${MEMORY_CONTENT_MAX_BYTES} UTF-8 bytes. Required for save.`,
      },
      query: {
        type: 'string',
        description: 'Literal text to find. Omit to list recent accessible memories.',
      },
      id: {
        type: 'string',
        description: 'Memory identifier returned by save or search. Required for delete.',
      },
      scope: {
        type: 'string', enum: ['shared', 'session'],
        description: 'Visibility of a new memory; defaults to shared.',
      },
      limit: {
        type: 'integer',
        description: 'Maximum search results, from 1 to 10; defaults to 5.',
      },
    },
    output: { schema: OUTPUT_SCHEMA, render: renderValue },
    async execute(args, exec): Promise<MemoryResult | MemoryError> {
      const agent = exec.agent
      // Every operation needs a live calling Agent: shared visibility is
      // deployment-local, not unauthenticated access.
      if (agent === undefined || ctx.agents.get(agent.id) !== agent) {
        return { code: 'agent_required', message: 'bot_memory requires a live calling Agent.' }
      }
      if (exec.signal.aborted) return internalError()
      const invalid = invalidCombination(args)
      if (invalid !== undefined) return invalid
      switch (args.action) {
        case 'save': {
          return serialize(() => guardedWrite(async () => {
            exec.signal.throwIfAborted()
            return save(args, agent)
          }))
        }
        case 'search': return search(args, agent)
        case 'delete': {
          return serialize(() => guardedWrite(async () => {
            exec.signal.throwIfAborted()
            return drop(args, agent)
          }))
        }
      }
    },
    presentCall: args =>
      args.action === 'search' ? present('Search memory', 'read')
        : args.action === 'delete' ? present('Delete memory', 'other')
          : present('Save memory', 'other'),
  }))
  ctx.effect(() => dispose, 'bot-memory: tool')

  /** A backend write failure collapses to one stable error code. */
  async function guardedWrite(operation: () => Promise<MemoryResult | MemoryError>): Promise<MemoryResult | MemoryError> {
    try {
      return await operation()
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      return internalError()
    }
  }

  /** Reject argument fields the chosen action does not accept. */
  function invalidCombination(args: {
    action: 'save' | 'search' | 'delete'
    content?: string
    query?: string
    id?: string
    scope?: 'shared' | 'session'
    limit?: number
  }): MemoryError | undefined {
    const refuse = (message: string): MemoryError => ({ code: 'invalid_arguments', message })
    switch (args.action) {
      case 'save':
        if (args.query !== undefined || args.id !== undefined || args.limit !== undefined) {
          return refuse('bot_memory save accepts only content and scope.')
        }
        if (args.content === undefined || args.content === '') {
          return refuse('bot_memory save requires non-empty content.')
        }
        if (Buffer.byteLength(args.content, 'utf8') > MEMORY_CONTENT_MAX_BYTES) {
          return refuse(`bot_memory content exceeds ${MEMORY_CONTENT_MAX_BYTES} UTF-8 bytes.`)
        }
        return undefined
      case 'search':
        if (args.content !== undefined || args.id !== undefined || args.scope !== undefined) {
          return refuse('bot_memory search accepts only query and limit.')
        }
        if (args.limit !== undefined && (!Number.isInteger(args.limit) || args.limit < 1 || args.limit > 10)) {
          return refuse('bot_memory limit must be an integer from 1 to 10.')
        }
        return undefined
      case 'delete':
        if (args.content !== undefined || args.query !== undefined || args.scope !== undefined || args.limit !== undefined) {
          return refuse('bot_memory delete accepts only id.')
        }
        if (args.id === undefined || args.id === '') {
          return refuse('bot_memory delete requires an id.')
        }
        return undefined
    }
  }

  /** Admit one new record; a full store refuses instead of evicting. */
  async function save(
    args: { content?: string; scope?: 'shared' | 'session' },
    agent: Agent,
  ): Promise<MemoryResult | MemoryError> {
    if (records.size >= config.maxRecords) {
      return { code: 'capacity_reached', message: 'bot_memory store is full; delete memories before saving more.' }
    }
    const scope = args.scope ?? 'shared'
    const record: MemoryRecord = {
      id: randomUUID(),
      content: args.content!,
      scope,
      ...scope === 'session' ? { ownerSession: agent.session.id } : {},
      updatedAt: Date.now(),
    }
    await records.put(record.id, record)
    return { action: 'save', memories: [recordView(record)] }
  }

  /** Literal substring search over the records this caller may see. */
  function search(
    args: { query?: string; limit?: number },
    agent: Agent,
  ): MemoryResult {
    const query = args.query === undefined ? undefined : args.query.toLowerCase()
    const limit = args.limit ?? 5
    const hits = [...records.entries()]
      .filter(([, record]) => accessible(record, agent))
      .filter(([, record]) => query === undefined || record.content.toLowerCase().includes(query))
      .sort(([a, x], [b, y]) => y.updatedAt - x.updatedAt || (a < b ? 1 : -1))
      .slice(0, limit)
    return { action: 'search', memories: hits.map(([, record]) => recordView(record)) }
  }

  /** Delete one accessible record; unknown or inaccessible ids look identical. */
  async function drop(
    args: { id?: string },
    agent: Agent,
  ): Promise<MemoryResult> {
    const record = records.get(args.id!)
    if (record === undefined || !accessible(record, agent)) {
      return { action: 'delete', memories: [], deleted: false }
    }
    return { action: 'delete', memories: [], deleted: await records.delete(args.id!) }
  }

  /** Shared records are deployment-local; session records are private to their owner. */
  function accessible(record: MemoryRecord, agent: Agent): boolean {
    return record.scope === 'shared' || record.ownerSession === agent.session.id
  }
}
