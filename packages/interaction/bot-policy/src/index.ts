/**
 * Bot approval policy: a `tools/pre-execute` guard that turns the runtime's
 * `allow` into a one-time `ask` for every persistent or consequential
 * operation — shell commands, scheduled-task changes, memory writes,
 * teammate-bot creation, and configured browser tools. It never weakens an
 * upstream deny, cancel, or ask, never reuses an approval (each call asks its
 * own), and fails closed whenever the approval service is absent or refuses.
 * @module @deepseek-ai/dsh-bot-policy
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PreToolDecision, ToolExecution } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'

/** Cordis identity for the Bot approval policy. */
export const name = 'bot-policy'

/** Services the plugin consumes: the ToolRuntime's pre-execute waterfall. */
export const inject = ['tools']

/** Bot policy plugin configuration. */
export interface Config {
  /** Tool-name prefixes treated as browser operations. */
  browserToolPrefixes: string[]
}

/** Validated Bot policy configuration; every entry must be a non-blank prefix. */
export const Config = z.object({
  browserToolPrefixes: z.array(z.string().pattern(/\S/u)).min(1)
    .default(['mcp__playwright-mcp__', 'mcp__chrome-devtools-mcp__']),
})

interface ApprovalCopy {
  reason: string
  displayReason: { readonly en: string; readonly zh: string }
}

const COMMAND: ApprovalCopy = {
  reason: 'DeepSeek Bot requires one-time approval before running a command.',
  displayReason: {
    en: 'DeepSeek Bot requires one-time approval before running a command.',
    zh: 'DeepSeek Bot 在运行命令前需要一次性批准。',
  },
}

const SCHEDULE: ApprovalCopy = {
  reason: 'DeepSeek Bot requires one-time approval before creating or changing a scheduled task.',
  displayReason: {
    en: 'DeepSeek Bot requires one-time approval before creating or changing a scheduled task.',
    zh: 'DeepSeek Bot 在创建或更改计划任务前需要一次性批准。',
  },
}

const MEMORY: ApprovalCopy = {
  reason: 'DeepSeek Bot requires one-time approval before changing persistent memory.',
  displayReason: {
    en: 'DeepSeek Bot requires one-time approval before changing persistent memory.',
    zh: 'DeepSeek Bot 在更改持久记忆前需要一次性批准。',
  },
}

const BROWSER: ApprovalCopy = {
  reason: 'DeepSeek Bot requires one-time approval before operating a browser.',
  displayReason: {
    en: 'DeepSeek Bot requires one-time approval before operating a browser.',
    zh: 'DeepSeek Bot 在操作浏览器前需要一次性批准。',
  },
}

const TEAMMATE: ApprovalCopy = {
  reason: 'DeepSeek Bot requires one-time approval before creating a teammate bot.',
  displayReason: {
    en: 'DeepSeek Bot requires one-time approval before creating a teammate bot.',
    zh: 'DeepSeek Bot 在创建协作机器人前需要一次性批准。',
  },
}

const SHELL_TOOLS = new Set(['bash', 'pwsh'])
const SCHEDULE_TOOLS = new Set(['schedule_create', 'schedule_update', 'schedule_delete'])
const TEAMMATE_TOOLS = new Set(['spawn_teammate'])

/** The `bot_memory` action a call requests, when its arguments name one. */
function memoryAction(args: unknown): string | undefined {
  if (args === null || typeof args !== 'object') return undefined
  const action = (args as { action?: unknown }).action
  return typeof action === 'string' ? action : undefined
}

/** The one-time-ask gate a call falls under, or undefined when policy permits it. */
function gateFor(exec: ToolExecution, config: Config): ApprovalCopy | undefined {
  if (SHELL_TOOLS.has(exec.name)) return COMMAND
  if (SCHEDULE_TOOLS.has(exec.name)) return SCHEDULE
  if (TEAMMATE_TOOLS.has(exec.name)) return TEAMMATE
  if (exec.name === 'bot_memory') {
    const action = memoryAction(exec.arguments)
    return action === 'save' || action === 'delete' ? MEMORY : undefined
  }
  if (config.browserToolPrefixes.some(prefix => exec.name.startsWith(prefix))) return BROWSER
  return undefined
}

/**
 * Install the prepended gate: consult every later listener first, retain any
 * denial, cancellation, or earlier ask, and only escalate a clean `allow`
 * into this call's own `ask`. Each gated call produces a fresh ask — the
 * runtime's approval channel never reuses one grant.
 * @param ctx - plugin context owning the listener's lifecycle.
 * @param config - validated browser-prefix list.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.effect(() => ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const downstream = await next()
    if (downstream.kind !== 'allow') return downstream
    const copy = gateFor(exec, config)
    if (copy === undefined) return downstream
    return { kind: 'ask', reason: copy.reason, displayReason: copy.displayReason }
  }, { prepend: true }), 'bot-policy: pre-execute gate')
}
