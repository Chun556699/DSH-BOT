/** REAL-composition test: bot_memory booted through the Loader over the JSON backend. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import type { Agent } from '@deepseek-ai/dsh-agent'
import Agents from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import Llm, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import Sessions, { SessionId } from '@deepseek-ai/dsh-session'
import Projections from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import Tools from '@deepseek-ai/dsh-tools'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import * as BotMemory from '../src/index.ts'

const roots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

class FixtureModel extends LlmAdapter {
  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, inputModalities: ['text'] })
  }
  async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: 'ok' }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ok' } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function execute(ctx: Context, agent: Agent, args: Record<string, unknown>) {
  return ctx.tools.execute({
    name: 'bot_memory',
    arguments: args,
    callId: ToolCallId(`call-${Math.random().toString(36).slice(2)}`),
    signal: new AbortController().signal,
    agent,
  })
}

/** Boot the Loader composition once over `root` and return the mounted context. */
async function load(root: string) {
  const model = new FixtureModel()
  const modules = new Map<string, unknown>([
    ['storage', Storage],
    ['json', StorageJson],
    ['tools', Tools],
    ['storageDomain', StorageDomain],
    ['bot-memory', BotMemory],
    ['prompt', SystemPrompt],
    ['llm', Llm],
    ['sessions', Sessions],
    ['agents', Agents],
    ['loop', AgentLoop],
    ['projections', Projections],
    ['fs', LocalFileSystem],
    ['workingDirectory', WorkingDirectory],
    ['model', { inject: ['llm'], apply(ctx: Context) { ctx.effect(() => ctx.llm.registerAdapter(['fixture'], model)) } }],
  ])
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, JSON.stringify([
    { id: 'storage', name: 'storage', config: {} },
    { id: 'json', name: 'json', config: { root: join(root, 'json-units') } },
    { id: 'tools', name: 'tools', config: {} },
    { id: 'storageDomain', name: 'storageDomain', config: { backend: 'json' } },
    { id: 'bot-memory', name: 'bot-memory', config: {} },
    { id: 'prompt', name: 'prompt', config: {} },
    { id: 'llm', name: 'llm', config: {} },
    { id: 'sessions', name: 'sessions', config: {} },
    { id: 'agents', name: 'agents', config: {} },
    { id: 'loop', name: 'loop', config: { agents: [] } },
    { id: 'projections', name: 'projections', config: {} },
    { id: 'fs', name: 'fs', config: {} },
    { id: 'workingDirectory', name: 'workingDirectory', config: {} },
    { id: 'model', name: 'model', config: {} },
  ]))
  const ctx = new Context()
  contexts.push(ctx)
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`Unexpected fixture module ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof ctx.loader.internal>
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return ctx
}

it('mounts through the real Loader and persists records across restarts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bot-memory-'))
  roots.push(root)

  const first = await load(root)
  expect(first.tools.schemas().some(tool => tool.name === 'bot_memory')).toBe(true)
  const owner = await first.agents.create({ sessionId: SessionId('owner'), meta: { cwd: root }, agentOptions: { provider: 'fixture', model: 'fixture' } })
  const saved = await execute(first, owner.agent, { action: 'save', content: 'persistent fact', scope: 'session' })
  expect(saved.isError).toBe(false)
  const id = (saved.value as { memories: { id: string }[] }).memories[0]!.id
  await owner.dispose()
  await first.fiber.dispose()
  contexts.length = 0

  const second = await load(root)
  expect(second.tools.schemas().some(tool => tool.name === 'bot_memory')).toBe(true)
  const resumed = await second.agents.create({ sessionId: SessionId('owner'), meta: { cwd: root }, agentOptions: { provider: 'fixture', model: 'fixture' } })
  const found = await execute(second, resumed.agent, { action: 'search', query: 'persistent' })
  const hits = (found.value as { memories: { id: string; content: string; scope: string }[] }).memories
  expect(hits).toHaveLength(1)
  expect(hits[0]?.id).toBe(id)
  expect(hits[0]?.scope).toBe('session')
})
