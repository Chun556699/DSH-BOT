import { Context, Service } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { GroupHeroMembers, GroupMembersAside, GroupSenderName } from '../src/client/GroupMembers.tsx'
import { TeamAction, type TeamActionInjected } from '../src/client/TeamAction.tsx'
import { apply, inject } from '../src/client/index.ts'
import { apply as nodeApply } from '../src/index.ts'

const SESSION = 'team-session' as SessionId
const CHILD = 'team-child' as SessionId

async function bench(options: { addressed?: boolean; spawn?: (...args: unknown[]) => unknown } = {}) {
  const ctx = new Context()
  const navigation: unknown[] = []
  const spawnCalls: unknown[][] = []
  const mountCalls: unknown[] = []
  let mainSessionId = options.addressed === true ? CHILD : SESSION
  ctx.provide('sessions', {
    binding: (id: SessionId) => options.addressed === true && id === CHILD
      ? { session: { getSnapshot: () => ({
        subagent: {
          address: {
            parentSessionId: SESSION,
            childSessionId: CHILD,
            mode: 'continuable' as const,
          },
        },
      }) } }
      : undefined,
    refreshProjections: (id: SessionId) => {
      navigation.push(['refresh', id])
      return Promise.resolve()
    },
    retainInfo: (id: SessionId) => ({
      getSnapshot: () => ({
        referenceCount: id === mainSessionId ? 1 : 0,
        retainedBy: id === mainSessionId ? { mainView: 1 } : {},
      }),
      subscribe: () => () => {},
    }),
  })
  ctx.provide('uiWorkspace', {
    openSession: (target: unknown) => { navigation.push(['open', target]) },
  } as never)
  class Remote extends Service {
    constructor() { super(ctx, 'remote') }
    async $mount(contribution: unknown) {
      mountCalls.push(contribution)
      return async () => {}
    }
  }
  new Remote()
  ctx.provide('remote.agentTeams', {
    spawnTeammate: async (...args: unknown[]) => {
      spawnCalls.push(args)
      return options.spawn === undefined
        ? { ok: true, value: { id: CHILD, name: 'child', role: 'teammate', phase: 'active' } }
        : options.spawn(...args)
    },
  } as never)
  ctx.provide('configForms', {
    get: () => ({
      getSnapshot: () => ({ status: 'ready', value: { botGroupPreset: 'bot-group' } }),
      subscribe: () => () => {},
    }),
  } as never)
  ctx.provide('conversation', {})
  ctx.provide('locale', new LocaleRuntime(ctx))
  await ctx.plugin(SlotRegistry).await()
  const collapseHeader = ctx.slots.register({
    name: 'root',
    children: {
      'conversation.session.header.actions': { kind: 'list', scope: 'session' },
      'conversation.session.aside': { kind: 'list', scope: 'session' },
      'conversation.hero.group': { kind: 'single', scope: 'session' },
      'conversation.chat.sender': { kind: 'single', scope: 'session' },
    },
  } as never, () => null)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const entry = () => ctx.slots.entries('conversation.session.header.actions')
    .find(candidate => candidate.component === TeamAction)
  const actions = (): TeamActionInjected => {
    const injected = entry()!.inject!() as unknown as TeamActionInjected
    if (typeof injected.openTeammate !== 'function' || typeof injected.addTeammate !== 'function') {
      throw new Error('Team header action lacks its injected callbacks')
    }
    return injected
  }
  return {
    ctx,
    fiber,
    navigation,
    entry,
    actions,
    collapseHeader,
    spawnCalls,
    mountCalls,
    select: (sessionId: SessionId) => { mainSessionId = sessionId },
  }
}

describe('ui-team browser plugin', () => {
  it('registers one disposable header action and mounts the Team Remote namespace', async () => {
    const b = await bench()
    expect(inject).toEqual(['sessions', 'uiWorkspace', 'slots', 'locale', 'remote', 'configForms'])
    expect(b.mountCalls).toHaveLength(1)
    expect(b.entry()).toMatchObject({
      options: { id: 'agent-team', order: -20 },
      locale: 'agent-team',
    })
    const t = b.ctx.locale.bind('agent-team')
    expect(t('trigger')).toBe('Agent Team')

    expect(b.navigation).toEqual([])

    await b.fiber.dispose()
    expect(b.entry()).toBeUndefined()
    expect(t('empty')).toBe('empty')
  })

  it('occupies the group-chat member slots and leaves them on dispose', async () => {
    const b = await bench()
    const group = () => ({
      aside: b.ctx.slots.entries('conversation.session.aside').find(entry => entry.component === GroupMembersAside),
      hero: b.ctx.slots.entries('conversation.hero.group').find(entry => entry.component === GroupHeroMembers),
      sender: b.ctx.slots.entries('conversation.chat.sender').find(entry => entry.component === GroupSenderName),
    })
    const { aside, hero, sender } = group()
    expect(aside).toMatchObject({ options: { id: 'agent-team-members' }, locale: 'agent-team' })
    expect(Object.keys(aside!.inject!() as object).sort()).toEqual(['addTeammate', 'openTeammate'])
    expect(Object.keys(hero!.inject!() as object)).toEqual(['addTeammate'])
    expect(sender).toMatchObject({ locale: 'agent-team' })
    await b.fiber.dispose()
    expect(group()).toEqual({ aside: undefined, hero: undefined, sender: undefined })
  })

  it('opens a continuable teammate address without touching the parent catalog', async () => {
    const b = await bench()
    b.actions().openTeammate(SESSION, CHILD)
    expect(b.navigation).toEqual([
      ['open', { parentSessionId: SESSION, childSessionId: CHILD, mode: 'continuable' }],
    ])
  })

  it('routes teammate navigation from an addressed teammate conversation back through its Lead', async () => {
    const b = await bench({ addressed: true })
    b.actions().openTeammate(CHILD, CHILD)
    expect(b.navigation).toEqual([
      ['open', { parentSessionId: SESSION, childSessionId: CHILD, mode: 'continuable' }],
    ])
  })

  it('opens the Lead from an addressed teammate conversation', async () => {
    const b = await bench({ addressed: true })
    b.actions().openTeammate(CHILD, SESSION)
    expect(b.navigation).toEqual([['open', SESSION]])
  })

  it('does not open a teammate from a conversation outside the main view', async () => {
    const b = await bench()
    b.select('other-session' as SessionId)
    b.actions().openTeammate(SESSION, CHILD)
    expect(b.navigation).toEqual([])
  })

  it('spawns teammates against the Lead session and surfaces Remote failures', async () => {
    const b = await bench({
      addressed: true,
      spawn: async () => ({ ok: false, error: { message: 'member limit reached' } }),
    })
    const message = await b.actions().addTeammate(CHILD, { name: 'writer', description: 'Writes docs' })
    expect(b.spawnCalls).toEqual([[SESSION, { name: 'writer', description: 'Writes docs' }]])
    expect(message).toBe('member limit reached')
  })

  it('returns null once the Remote spawn settles', async () => {
    const b = await bench()
    const message = await b.actions().addTeammate(SESSION, { name: 'reader', description: 'Reads' })
    expect(message).toBeNull()
    expect(b.spawnCalls).toEqual([[SESSION, { name: 'reader', description: 'Reads' }]])
  })

  it('re-registers after the conversation header slot is collapsed and declared again', async () => {
    const b = await bench()
    expect(b.entry()).toBeDefined()
    b.collapseHeader()
    expect(b.entry()).toBeUndefined()
    b.ctx.slots.register({
      name: 'root',
      children: { 'conversation.session.header.actions': { kind: 'list', scope: 'session' } },
    } as never, () => null)
    await Promise.resolve()
    expect(b.entry()).toBeDefined()
  })

  it('keeps the node half inert', () => {
    expect(() => { nodeApply() }).not.toThrow()
  })
})
