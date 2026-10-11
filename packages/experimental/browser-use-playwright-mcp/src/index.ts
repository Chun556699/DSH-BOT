/** Chromium browser tools from the pinned Playwright MCP server. @module */

import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import Schema from '@deepseek-ai/schemastery'
import { mountSessionMcp, validateBrowserMcpConfig } from '@deepseek-ai/dsh-experimental-browser-use-runtime/mcp'
import type { BrowserMcpAttachConfig } from '@deepseek-ai/dsh-experimental-browser-use-runtime/mcp'
import type {} from '@deepseek-ai/dsh-working-directory'

/** Cordis identity for the Playwright MCP browser provider. */
export const name = 'experimental-browser-use-playwright-mcp'

/** Services required for scoped MCP startup and prompt readiness checks. */
export const inject = ['browserUse', 'agents', 'tools', 'systemPrompt', 'workingDirectory']

/** Launch settings for this provider, with optional profile persistence. */
export interface PlaywrightMcpLaunchConfig {
  /** Launch a new Chromium browser for each live Session. */
  mode: 'launch'
  /** Whether Chromium runs without a visible window; defaults to true. */
  headless: boolean
  /** Chromium executable; omission uses the upstream server's installation discovery. */
  executablePath?: string
  /** Per-call timeout override in milliseconds; omission uses the MCP client default. */
  toolCallTimeoutMs?: number
  /**
   * Absolute local directory root under which each live Session gets its own
   * persistent Chromium profile. Omission keeps upstream `--isolated` behavior:
   * browser state is discarded with the Session. The root is a deployment
   * choice — cookies and site storage survive across sessions, so it must
   * name a directory the operator trusts.
   */
  userDataRoot?: string
}

/** Fixed launch or attachment choice for the Playwright MCP provider. */
export type Config = BrowserMcpAttachConfig | PlaywrightMcpLaunchConfig

/** Validate the launch or attachment configuration before activation. */
export const Config: Schema<BrowserMcpAttachConfig | (Omit<PlaywrightMcpLaunchConfig, 'headless'> & { headless?: boolean }), Config> = Schema.union([
  Schema.object({
    mode: Schema.const('launch').required(),
    headless: Schema.boolean().default(true),
    executablePath: Schema.string().pattern(/\S/u),
    toolCallTimeoutMs: Schema.number().min(1),
    userDataRoot: Schema.string().pattern(/\S/u),
  }),
  Schema.object({
    mode: Schema.const('attach').required(),
    endpoint: Schema.string().pattern(/^https?:\/\/[^\s/]+|^wss?:\/\/[^\s/]+/u).required(),
    toolCallTimeoutMs: Schema.number().min(1),
  }),
])

/**
 * One Session's persistent profile directory under the configured root.
 * The durable session id is hashed so ids with path-unsafe characters stay
 * inside the root, and equal sessions always resume the same directory.
 * @param root - absolute local profile root.
 * @param agent - the Session the browser serves.
 * @returns the per-session user-data directory path.
 */
function userDataDir(root: string, agent: Agent): string {
  const digest = createHash('sha256').update(String(agent.session.id)).digest('hex')
  return join(root, digest)
}

/**
 * Expose Playwright's upstream tools in each live Session's scope.
 * The pinned npm server runs under the current Node executable; browser state
 * is ephemeral unless `userDataRoot` opts the deployment into per-session
 * persistent profiles.
 * @param ctx - provider context supplying browser use, Agents, and tools.
 * @param config - validated browser choice and optional tool timeout.
 */
export function apply(ctx: Context, config: Config): void {
  validateBrowserMcpConfig(config)
  const persistent = config.mode === 'launch' && config.userDataRoot !== undefined
  // The root is trusted deployment input; a relative one would bind profiles
  // to whatever cwd the launch happens to have, so it fails before mount.
  if (config.mode === 'launch' && config.userDataRoot !== undefined && !isAbsolute(config.userDataRoot)) {
    throw new Error('userDataRoot must be an absolute local directory')
  }
  const cli = join(dirname(fileURLToPath(import.meta.resolve('@playwright/mcp/package.json'))), 'cli.js')
  // Upstream environment options can otherwise replace the configured browser
  // mode or import an unrelated profile. Empty values mean absent to its parser.
  const env = Object.fromEntries(Object.keys(process.env)
    .filter(key => key.toUpperCase().startsWith('PLAYWRIGHT_MCP_'))
    .map(key => [key, '']))
  const args = [cli, '--browser', 'chromium']
  let argsForAgent: ((agent: Agent, signal: AbortSignal) => Promise<string[]>) | undefined
  if (config.mode === 'attach') {
    args.push('--cdp-endpoint', config.endpoint)
  } else if (persistent) {
    const root = config.userDataRoot as string
    argsForAgent = async (agent, signal) => {
      signal.throwIfAborted()
      const dir = userDataDir(root, agent)
      await mkdir(dir, { recursive: true })
      signal.throwIfAborted()
      const agentArgs = [cli, '--browser', 'chromium', '--user-data-dir', dir]
      if (config.headless) agentArgs.push('--headless')
      if (config.executablePath !== undefined) agentArgs.push('--executable-path', config.executablePath)
      return agentArgs
    }
  } else {
    args.push('--isolated')
    if (config.headless) args.push('--headless')
    if (config.executablePath !== undefined) args.push('--executable-path', config.executablePath)
  }
  mountSessionMcp(ctx, {
    name: 'playwright-mcp',
    exclusive: config.mode === 'attach',
    command: process.execPath,
    args,
    ...argsForAgent === undefined ? {} : { argsForAgent },
    env,
    ...config.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: config.toolCallTimeoutMs },
  })
}
