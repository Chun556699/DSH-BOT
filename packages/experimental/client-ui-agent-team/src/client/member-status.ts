/** Live member status shared by the Team panel, the group member aside, and the header roster. */

import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TeamMemberProjection } from '@deepseek-ai/dsh-experimental-agent-team/client'
import type { StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { NS, TeamKey } from './locales.ts'

/** Durable lifecycle overlaid with the member Session's live turn activity. */
export type MemberStatus = 'running' | 'inactive' | 'provisioning' | 'failed'

/** Session seats a member row reads its live activity from. */
export type MemberSeats = Pick<PropsRuntime<'conversation.session.header.actions'>,
  'sessionId' | 'useSessions' | 'useSessionStatus'>

/**
 * Locale key naming one member status.
 * @param status - live member status.
 * @returns the status label key.
 */
export function memberStatusKey(status: MemberStatus): TeamKey {
  switch (status) {
    case 'running': return 'memberStatus.running'
    case 'inactive': return 'memberStatus.inactive'
    case 'provisioning': return 'memberStatus.provisioning'
    case 'failed': return 'memberStatus.failed'
  }
}

/**
 * Status dot shown for a member that is not idle.
 * @param status - live member status other than inactive.
 * @returns the dot state.
 */
export function memberDotState(status: Exclude<MemberStatus, 'inactive'>): StateDotState {
  switch (status) {
    case 'running':
    case 'provisioning': return 'ongoing'
    case 'failed': return 'error'
  }
}

/**
 * Read one member's live status: an active member is running while its
 * Session runs a Turn, otherwise its durable phase applies.
 * @param member - roster row.
 * @param seats - Session seats of the rendering slot.
 * @returns the live status.
 */
export function useMemberStatus(
  member: TeamMemberProjection,
  { useSessions, useSessionStatus }: Pick<MemberSeats, 'useSessions' | 'useSessionStatus'>,
): MemberStatus {
  const running = useSessionStatus(state => state.get(member.id)?.running)
  const summaryRunning = useSessions(state => state.byId[member.id]?.running)
  return member.phase === 'active'
    ? (running ?? summaryRunning) === true ? 'running' : 'inactive'
    : member.phase
}

/**
 * Display name of one member; the Lead row reads as the group's Master Bot.
 * @param member - roster row.
 * @param t - Team locale seat.
 * @returns the member's display name.
 */
export function memberDisplayName(member: Pick<TeamMemberProjection, 'name' | 'role'>, t: TranslateNS<typeof NS>): string {
  return member.role === 'lead' ? t('member.lead') : member.name
}

/**
 * Localized member count, singular-aware.
 * @param count - members, the Lead included.
 * @param t - Team locale seat.
 * @returns the count label.
 */
export function memberCountLabel(count: number, t: TranslateNS<typeof NS>): string {
  return t(count === 1 ? 'member.count.one' : 'member.count.other', { count })
}

/**
 * Whether the viewer may open a member's conversation from a roster.
 * @param member - roster row.
 * @param status - its live status.
 * @param sessionId - Session the roster renders for.
 * @returns false for the current Session and for members without a usable Session.
 */
export function memberOpenable(member: TeamMemberProjection, status: MemberStatus, sessionId: SessionId): boolean {
  return member.id !== sessionId && status !== 'failed' && status !== 'provisioning'
}
