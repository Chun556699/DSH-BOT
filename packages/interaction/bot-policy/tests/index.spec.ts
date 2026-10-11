/** Bot policy tests through the real ToolRuntime.execute pipeline. */
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Tools, { defineTool } from '@deepseek-ai/dsh-tools'
import * as BotPolicy from '../src/index.ts'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

/** Minimal live Agent fixture: policy only needs `session.id` and identity. */
function agentFor(id = 'policy-agent'): Agent {
  return { id: SessionId(id), session: { id: SessionId(id) } as unknown as Agent['session'] } as unknown as Agent
}

const AGENT = agentFor()

type Body = () => Promise<{ ran: string | boolean }>

interface Bodies {
  bash: Mock<Body>
  pwsh: Mock<Body>
  scheduleUpdate: Mock<Body>
  memory: Mock<Body>
  browser: Mock<Body>
  teammate: Mock<Body>
}

/** Register one echo body under each covered tool name. */
function registerBodies(ctx: Context): Bodies {
  const echoParameters = {
    command: { type: 'string' },
    run_in_background: { type: 'boolean' },
    id: { type: 'string' },
    action: { type: 'string' },
    content: { type: 'string' },
    url: { type: 'string' },
  } as const
  const stub = (name: string, body: Body, parameters: readonly (keyof typeof echoParameters)[]) => {
    const schema = Object.fromEntries(parameters.map(key => [key, echoParameters[key]]))
    ctx.tools.register(defineTool({
      name,
      description: `${name} fixture`,
      parameters: schema,
      output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] },
      execute: body,
    }))
  }
  const bodies: Bodies = {
    bash: vi.fn<() => Promise<{ ran: string }>>(async () => ({ ran: 'bash' })),
    pwsh: vi.fn<() => Promise<{ ran: string }>>(async () => ({ ran: 'pwsh' })),
    scheduleUpdate: vi.fn<() => Promise<{ ran: string }>>(async () => ({ ran: 'schedule' })),
    memory: vi.fn<() => Promise<{ ran: string }>>(async () => ({ ran: 'memory' })),
    browser: vi.fn<() => Promise<{ ran: string }>>(async () => ({ ran: 'browser' })),
    teammate: vi.fn<() => Promise<{ ran: string }>>(async () => ({ ran: 'teammate' })),
  }
  stub('bash', async () => bodies.bash(), ['command', 'run_in_background'])
  stub('pwsh', async () => bodies.pwsh(), ['command', 'run_in_background'])
  stub('schedule_update', async () => bodies.scheduleUpdate(), ['id'])
  stub('bot_memory', async () => bodies.memory(), ['action', 'content', 'id'])
  stub('mcp__playwright-mcp__navigate', async () => bodies.browser(), ['url'])
  stub('spawn_teammate', async () => bodies.teammate(), ['id'])
  return bodies
}

interface AskRequest {
  toolName: string
  reason?: string
  displayReason?: { en: string; zh: string }
}

async function harness(options: { outcome?: string; withApproval?: boolean; config?: Record<string, unknown>; denyFirst?: boolean } = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(Tools)
  const asks: AskRequest[] = []
  if (options.withApproval !== false) {
    ctx.provide('approval', {
      request: async (request: AskRequest) => { asks.push(request); return options.outcome ?? 'allowed-once' },
    } as never)
  }
  if (options.denyFirst === true) {
    ctx.effect(() => ctx.on('tools/pre-execute', () => Promise.resolve({ kind: 'deny' as const, reason: 'upstream denied' })), 'deny-fixture')
  }
  const fiber = ctx.plugin(BotPolicy, BotPolicy.Config(options.config ?? {}))
  await fiber.await()
  const bodies = registerBodies(ctx)
  const execute = (name: string, args: Record<string, unknown>) => ctx.tools.execute({
    name,
    arguments: args,
    callId: ToolCallId(`call-${Math.random().toString(36).slice(2)}`),
    signal: new AbortController().signal,
    agent: AGENT,
  })
  return { ctx, fiber, bodies, asks, execute }
}

describe('shell commands', () => {
  it('asks before every bash call and never runs the body first', async () => {
    const { bodies, asks, execute } = await harness()
    const order: string[] = []
    bodies.bash.mockImplementation(async () => { order.push('body'); return { ran: true } })
    // Foreground default: promotion cannot bypass the gate.
    const first = await execute('bash', { command: 'echo hi', run_in_background: false })
    expect(first.isError).toBe(false)
    expect(asks).toHaveLength(1)
    expect(asks[0]?.reason).toBe('DeepSeek Bot requires one-time approval before running a command.')
    expect(asks[0]?.displayReason).toEqual({
      en: 'DeepSeek Bot requires one-time approval before running a command.',
      zh: 'DeepSeek Bot 在运行命令前需要一次性批准。',
    })
    expect(order).toEqual(['body'])
    // A second identical call asks again: one-time grants are not reusable.
    await execute('bash', { command: 'echo hi', run_in_background: false })
    expect(asks).toHaveLength(2)
    expect(order).toEqual(['body', 'body'])
    // Background requests gate identically.
    await execute('bash', { command: 'sleep 1', run_in_background: true })
    expect(asks).toHaveLength(3)
    // pwsh gates identically.
    await execute('pwsh', { command: 'Get-Date' })
    expect(asks).toHaveLength(4)
    expect(bodies.pwsh).toHaveBeenCalledTimes(1)
  })
})

describe('scheduled tasks, memory, and browser', () => {
  it('gates schedule_update with the scheduled-task copy', async () => {
    const { bodies, asks, execute } = await harness()
    await execute('schedule_update', { id: 'task-1' })
    expect(bodies.scheduleUpdate).toHaveBeenCalledTimes(1)
    expect(asks[0]?.reason).toBe('DeepSeek Bot requires one-time approval before creating or changing a scheduled task.')
    expect(asks[0]?.displayReason).toEqual({
      en: 'DeepSeek Bot requires one-time approval before creating or changing a scheduled task.',
      zh: 'DeepSeek Bot 在创建或更改计划任务前需要一次性批准。',
    })
  })

  it('gates memory saves and deletes but permits search', async () => {
    const { bodies, asks, execute } = await harness()
    await execute('bot_memory', { action: 'search' })
    expect(asks).toHaveLength(0)
    await execute('bot_memory', { action: 'save', content: 'note' })
    expect(asks.at(-1)?.reason).toBe('DeepSeek Bot requires one-time approval before changing persistent memory.')
    expect(asks.at(-1)?.displayReason).toEqual({
      en: 'DeepSeek Bot requires one-time approval before changing persistent memory.',
      zh: 'DeepSeek Bot 在更改持久记忆前需要一次性批准。',
    })
    await execute('bot_memory', { action: 'delete', id: 'x' })
    expect(asks).toHaveLength(2)
    expect(bodies.memory).toHaveBeenCalledTimes(3)
  })

  it('gates configured browser tool prefixes', async () => {
    const { bodies, asks, execute } = await harness()
    await execute('mcp__playwright-mcp__navigate', { url: 'https://example.com' })
    expect(asks[0]?.reason).toBe('DeepSeek Bot requires one-time approval before operating a browser.')
    expect(asks[0]?.displayReason).toEqual({
      en: 'DeepSeek Bot requires one-time approval before operating a browser.',
      zh: 'DeepSeek Bot 在操作浏览器前需要一次性批准。',
    })
    expect(bodies.browser).toHaveBeenCalledTimes(1)
  })

  it('gates teammate-bot creation with the teammate copy', async () => {
    const { bodies, asks, execute } = await harness()
    await execute('spawn_teammate', { id: 'writer' })
    expect(bodies.teammate).toHaveBeenCalledTimes(1)
    expect(asks[0]?.reason).toBe('DeepSeek Bot requires one-time approval before creating a teammate bot.')
    expect(asks[0]?.displayReason).toEqual({
      en: 'DeepSeek Bot requires one-time approval before creating a teammate bot.',
      zh: 'DeepSeek Bot 在创建协作机器人前需要一次性批准。',
    })
  })

  it('honours configured prefix overrides', async () => {
    const { bodies, asks, execute } = await harness({ config: { browserToolPrefixes: ['mcp__custom-browser__'] } })
    // The stock prefix no longer matches; only the configured one does.
    await execute('mcp__playwright-mcp__navigate', { url: 'https://example.com' })
    expect(bodies.browser).toHaveBeenCalledTimes(1)
    expect(asks).toHaveLength(0)
  })
})

describe('fail-closed behavior', () => {
  it('denies without an approval service', async () => {
    const { bodies, execute } = await harness({ withApproval: false })
    const result = await execute('bash', { command: 'echo hi' })
    expect(result.isError).toBe(true)
    expect(bodies.bash).not.toHaveBeenCalled()
  })

  it('denies on rejection, cancellation, and an unavailable channel', async () => {
    for (const outcome of ['rejected', 'cancelled', 'unavailable']) {
      const { bodies, execute } = await harness({ outcome })
      const result = await execute('bash', { command: 'echo hi' })
      expect(result.isError).toBe(true)
      expect(bodies.bash).not.toHaveBeenCalled()
    }
  })

  it('never weakens an upstream denial', async () => {
    const { bodies, asks, execute } = await harness({ denyFirst: true })
    const result = await execute('bash', { command: 'echo hi' })
    expect(result.isError).toBe(true)
    expect(bodies.bash).not.toHaveBeenCalled()
    // The retained denial never even reached the approval channel.
    expect(asks).toHaveLength(0)
  })
})

describe('lifecycle', () => {
  it('removes the policy listener on disposal', async () => {
    const { fiber, bodies, asks, execute } = await harness()
    await fiber.dispose()
    await execute('bash', { command: 'echo hi' })
    expect(asks).toHaveLength(0)
    expect(bodies.bash).toHaveBeenCalledTimes(1)
  })
})
