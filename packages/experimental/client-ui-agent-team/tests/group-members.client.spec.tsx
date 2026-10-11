// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TeamMemberProjection, TeamProjection } from '@deepseek-ai/dsh-experimental-agent-team/client'
import type { SessionListState, SessionSnapshot } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionStatusSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import {
  GroupHeroMembers, GroupMembersAside, GroupSenderName,
  type GroupHeroMembersProps, type GroupMembersAsideProps, type GroupMembersInjected, type GroupSenderNameProps,
} from '../src/client/GroupMembers.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const LEAD = 'lead-session' as SessionId
const WRITER = 'writer-session' as SessionId
const PENDING = 'pending-session' as SessionId
const lead: TeamMemberProjection = { id: LEAD, name: 'lead', role: 'lead', phase: 'active' }
const writer: TeamMemberProjection = { id: WRITER, name: 'writer', role: 'teammate', phase: 'active' }
const pending: TeamMemberProjection = { id: PENDING, name: 'reviewer', role: 'teammate', phase: 'provisioning' }

type Projections = SessionListState['projectionsBySession']

function bench(options: {
  team?: TeamProjection
  statuses?: SessionStatusSnapshot
  listing?: boolean
  openState?: SessionSnapshot['openState']
  openTeammate?: GroupMembersInjected['openTeammate']
  addTeammate?: GroupMembersInjected['addTeammate']
} = {}) {
  const projections: Projections = options.team === undefined
    ? {}
    : { [LEAD]: { state: 'ready', error: null, values: { agentTeam: options.team } } }
  const sessions = createSnapshotStore<SessionListState>({
    ids: [], byId: {}, phase: options.listing === true ? 'pending' : 'ready', projectionsBySession: projections,
  })
  const session = createSnapshotStore<SessionSnapshot>({
    sessionId: LEAD,
    pendingSubmissions: [],
    running: false,
    subagent: null,
    removed: false,
    openState: options.openState ?? 'open',
    openError: null,
    hasMore: false,
    loadingOlder: false,
    promptError: null,
    blank: false,
    lastAgentError: null,
    promptAttempted: false,
    awaitingFirstTurn: false,
  })
  const injected: GroupMembersInjected = {
    openTeammate: options.openTeammate ?? vi.fn(),
    addTeammate: options.addTeammate ?? vi.fn(async () => await Promise.resolve(null)),
  }
  const seats = {
    sessionId: LEAD,
    useSession: bindSnapshotSelector(session),
    useSessions: bindSnapshotSelector(sessions),
    useSessionStatus: bindSnapshotSelector(createSnapshotStore<SessionStatusSnapshot>(options.statuses ?? new Map())),
    t: makeTranslate(zh, commonZh),
  }
  return { sessions, injected, seats }
}

function setTeam(sessions: ReturnType<typeof bench>['sessions'], team: TeamProjection): void {
  act(() => {
    const current = sessions.getSnapshot()
    sessions.set({
      ...current,
      projectionsBySession: { ...current.projectionsBySession, [LEAD]: { state: 'ready', error: null, values: { agentTeam: team } } },
    })
  })
}

describe('GroupMembersAside', () => {
  it('lists every member with its live status and names the Lead as Master Bot', () => {
    const b = bench({
      team: { members: [lead, writer, pending], tasks: [] },
      statuses: new Map([[WRITER, { running: true, pendingInteraction: undefined, completionUnread: false }]]),
    })
    render(<GroupMembersAside {...{ ...b.seats, ...b.injected } as GroupMembersAsideProps} />)
    const region = screen.getByRole('region', { name: zh.roster })
    expect(region.querySelector('h3')?.textContent).toBe(`${zh.roster}3`)
    const rows = screen.getAllByRole('listitem').map(item => item.textContent)
    expect(rows).toEqual([
      `${zh['member.lead']}${zh['member.role.lead']}${zh['memberStatus.inactive']}`,
      `writer${zh['memberStatus.running']}`,
      `reviewer${zh['memberStatus.provisioning']}`,
    ])
    const [leadRow, writerRow, pendingRow] = screen.getAllByRole('button').slice(0, 3)
    expect(leadRow).toHaveProperty('disabled', true)
    expect(writerRow).toHaveProperty('disabled', false)
    expect(pendingRow).toHaveProperty('disabled', true)
  })

  it('opens a teammate conversation and surfaces navigation failures', () => {
    const openTeammate = vi.fn<GroupMembersInjected['openTeammate']>()
    const b = bench({ team: { members: [lead, writer], tasks: [] }, openTeammate })
    render(<GroupMembersAside {...{ ...b.seats, ...b.injected } as GroupMembersAsideProps} />)
    fireEvent.click(screen.getByRole('button', { name: /^writer/u }))
    expect(openTeammate).toHaveBeenCalledWith(LEAD, WRITER)
    openTeammate.mockImplementation(() => { throw new Error('navigation refused') })
    fireEvent.click(screen.getByRole('button', { name: /^writer/u }))
    expect(screen.getByRole('alert').textContent).toBe('Error: navigation refused')
  })

  it('shows loading, unavailable, and persisted-failure notices', () => {
    const loading = bench({ listing: true })
    const view = render(<GroupMembersAside {...{ ...loading.seats, ...loading.injected } as GroupMembersAsideProps} />)
    expect(screen.getByRole('status').textContent).toBe(zh.loading)
    view.unmount()

    const unavailable = bench()
    const second = render(<GroupMembersAside {...{ ...unavailable.seats, ...unavailable.injected } as GroupMembersAsideProps} />)
    expect(screen.getByRole('status').textContent).toBe(zh.unavailable)
    setTeam(unavailable.sessions, { members: [lead], tasks: [], failure: 'bad record' })
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByRole('alert').textContent).toBe(zh.failure.replace('{message}', 'bad record'))
    second.unmount()
  })

  it('adds a teammate through the injected Remote call', async () => {
    const addTeammate = vi.fn(async () => await Promise.resolve('member limit reached'))
    const b = bench({ team: { members: [lead], tasks: [] }, addTeammate })
    render(<GroupMembersAside {...{ ...b.seats, ...b.injected } as GroupMembersAsideProps} />)
    fireEvent.click(screen.getByRole('button', { name: zh['member.add'] }))
    fireEvent.change(screen.getByLabelText(zh['member.name']), { target: { value: 'writer' } })
    fireEvent.change(screen.getByLabelText(zh['member.description']), { target: { value: 'Writes docs' } })
    fireEvent.click(screen.getByRole('button', { name: zh['member.submit'] }))
    expect(addTeammate).toHaveBeenCalledWith(LEAD, { name: 'writer', description: 'Writes docs' })
    expect((await screen.findByRole('alert')).textContent).toBe('member limit reached')
  })
})

describe('GroupHeroMembers', () => {
  it('shows the bots already added beside the add-member form', () => {
    const b = bench({ team: { members: [lead, writer], tasks: [] } })
    render(<GroupHeroMembers {...{ ...b.seats, addTeammate: b.injected.addTeammate } as GroupHeroMembersProps} />)
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['writer'])
    expect(screen.getByRole('button', { name: zh['member.add'] })).toBeTruthy()
  })

  it('offers only the form before any bot joins and reports creation failures', async () => {
    const addTeammate = vi.fn(async () => await Promise.resolve('name already used'))
    const b = bench({ addTeammate })
    render(<GroupHeroMembers {...{ ...b.seats, addTeammate } as GroupHeroMembersProps} />)
    expect(screen.queryByRole('list')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: zh['member.add'] }))
    fireEvent.change(screen.getByLabelText(zh['member.name']), { target: { value: 'lead' } })
    fireEvent.change(screen.getByLabelText(zh['member.description']), { target: { value: 'Duplicates' } })
    fireEvent.click(screen.getByRole('button', { name: zh['member.submit'] }))
    expect((await screen.findByRole('alert')).textContent).toBe('name already used')
  })
})

describe('GroupSenderName', () => {
  it('resolves a relayed sender from the Lead roster', () => {
    const b = bench({ team: { members: [lead, writer], tasks: [] } })
    const view = render(<GroupSenderName {...{ ...b.seats, senderId: WRITER } as GroupSenderNameProps} />)
    expect(view.container.textContent).toBe('writer')
    view.rerender(<GroupSenderName {...{ ...b.seats, senderId: LEAD } as GroupSenderNameProps} />)
    expect(view.container.textContent).toBe(zh['member.lead'])
  })

  it('falls back to a generic label for a sender outside the roster', () => {
    const b = bench()
    const view = render(<GroupSenderName {...{ ...b.seats, senderId: PENDING } as GroupSenderNameProps} />)
    expect(view.container.textContent).toBe(zh['member.unknown'])
  })
})
