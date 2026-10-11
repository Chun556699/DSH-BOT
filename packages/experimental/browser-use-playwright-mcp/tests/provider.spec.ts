import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountSessionMcp } from '@deepseek-ai/dsh-experimental-browser-use-runtime/mcp'
import * as Provider from '../src/index.ts'

vi.mock('@deepseek-ai/dsh-experimental-browser-use-runtime/mcp', async importOriginal => ({
  ...await importOriginal<typeof import('@deepseek-ai/dsh-experimental-browser-use-runtime/mcp')>(),
  mountSessionMcp: vi.fn(),
}))
const roots: string[] = []
afterEach(async () => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('uses the pinned Playwright executable with isolated Chromium launch settings', () => {
  vi.stubEnv('PLAYWRIGHT_MCP_CDP_ENDPOINT', 'http://invalid.example:1')
  Provider.apply(new Context(), Provider.Config({ mode: 'launch', executablePath: '/custom/chromium', toolCallTimeoutMs: 123 }))
  const options = vi.mocked(mountSessionMcp).mock.calls[0]![1]
  expect(existsSync(options.args[0]!)).toBe(true)
  expect(options).toMatchObject({ name: 'playwright-mcp', exclusive: false, command: process.execPath, toolCallTimeoutMs: 123 })
  expect(options.env?.PLAYWRIGHT_MCP_CDP_ENDPOINT).toBe('')
  expect(options.args.slice(1)).toEqual(['--browser', 'chromium', '--isolated', '--headless', '--executable-path', '/custom/chromium'])
  expect('default' in Provider).toBe(false)
})

it('supports headed launch and attaches without launching a browser or creating a profile', () => {
  Provider.apply(new Context(), Provider.Config({ mode: 'launch', headless: false }))
  expect(vi.mocked(mountSessionMcp).mock.calls[0]![1].args.slice(1)).toEqual(['--browser', 'chromium', '--isolated'])
  Provider.apply(new Context(), Provider.Config({ mode: 'attach', endpoint: 'http://127.0.0.1:9222' }))
  const options = vi.mocked(mountSessionMcp).mock.calls[1]![1]
  expect(options.exclusive).toBe(true)
  expect(options.args.slice(1)).toEqual(['--browser', 'chromium', '--cdp-endpoint', 'http://127.0.0.1:9222'])
})

it('rejects malformed endpoints before mounting any browser resources', () => {
  expect(() => { Provider.apply(new Context(), Provider.Config({ mode: 'attach', endpoint: 'http://localhost:bad/path' })) }).toThrow('browser endpoint')
  expect(mountSessionMcp).not.toHaveBeenCalled()
})

const agentFor = (id: string) => ({ session: { id: id as SessionId } }) as Agent

describe('persistent profile root', () => {
  it('rejects a relative userDataRoot before mounting', () => {
    expect(() => {
      Provider.apply(new Context(), Provider.Config({ mode: 'launch', userDataRoot: 'relative/profiles' }))
    }).toThrow('userDataRoot')
    expect(mountSessionMcp).not.toHaveBeenCalled()
  })

  it('binds each durable session to its own hashed profile directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-bot-browser-'))
    roots.push(root)
    Provider.apply(new Context(), Provider.Config({ mode: 'launch', userDataRoot: root, toolCallTimeoutMs: 7 }))
    const options = vi.mocked(mountSessionMcp).mock.calls[0]![1]
    expect(options.toolCallTimeoutMs).toBe(7)
    const argsForAgent = options.argsForAgent
    expect(argsForAgent).toBeTypeOf('function')
    const first = await argsForAgent!(agentFor('session-a'), new AbortController().signal)
    const second = await argsForAgent!(agentFor('session-b'), new AbortController().signal)
    const dirOf = (args: string[]) => args.at(args.indexOf('--user-data-dir') + 1)!
    const firstDir = dirOf(first)
    const secondDir = dirOf(second)
    // No --isolated, explicit per-session --user-data-dir under the root.
    expect(first).not.toContain('--isolated')
    expect(first.slice(1)).toEqual(['--browser', 'chromium', '--user-data-dir', firstDir, '--headless'])
    expect(firstDir.startsWith(root)).toBe(true)
    expect(firstDir).not.toBe(secondDir)
    expect(secondDir.startsWith(root)).toBe(true)
    // Same session resumes the same directory; the created directory exists.
    const again = await argsForAgent!(agentFor('session-a'), new AbortController().signal)
    expect(dirOf(again)).toBe(firstDir)
    expect(existsSync(firstDir)).toBe(true)
    // Traversal-like ids cannot escape the root: the id is hashed to hex.
    const escaped = await argsForAgent!(agentFor('../../outside'), new AbortController().signal)
    expect(dirOf(escaped).startsWith(join(root))).toBe(true)
  })

  it('honours cancellation before the server starts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-bot-browser-'))
    roots.push(root)
    Provider.apply(new Context(), Provider.Config({ mode: 'launch', userDataRoot: root }))
    const argsForAgent = vi.mocked(mountSessionMcp).mock.calls[0]![1].argsForAgent!
    const controller = new AbortController()
    controller.abort()
    await expect(argsForAgent(agentFor('aborted'), controller.signal)).rejects.toThrow()
    expect(mountSessionMcp).toHaveBeenCalledOnce()
  })
})
