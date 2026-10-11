/** Group-chat member surfaces: the pinned roster aside, the blank-chat member setup, sender names, and the header avatar stack. */

import { useEffect, useState } from 'react'
import type { TeamMemberProjection } from '@deepseek-ai/dsh-experimental-agent-team/client'
import { BotAvatar, StateDot, Tag, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import { AddMemberForm } from './AddMemberForm.tsx'
import {
  memberDisplayName, memberDotState, memberOpenable, memberStatusKey, useMemberStatus, type MemberSeats,
} from './member-status.ts'
import type { TeamActionInjected } from './TeamAction.tsx'
import type { NS } from './locales.ts'
import css from './GroupMembers.module.css'

/** Business actions the group member surfaces receive from the browser plugin. */
export type GroupMembersInjected = Pick<TeamActionInjected, 'openTeammate' | 'addTeammate'>

/** Full props of the pinned group member aside. */
export type GroupMembersAsideProps =
  PropsRuntime<'conversation.session.aside'>
  & GroupMembersInjected
  & PropsLocale<typeof NS>

/** Full props of the blank group chat's member setup. */
export type GroupHeroMembersProps =
  PropsRuntime<'conversation.hero.group'>
  & Pick<GroupMembersInjected, 'addTeammate'>
  & PropsLocale<typeof NS>

/** Full props of a relayed message's sender label. */
export type GroupSenderNameProps =
  PropsRuntime<'conversation.chat.sender'>
  & PropsLocale<typeof NS>

/**
 * Overlapping avatars of the first members, Lead first.
 * @param props.members - roster rows in roster order.
 * @returns the decorative avatar stack.
 */
export function MemberAvatarStack({ members }: { members: readonly TeamMemberProjection[] }) {
  return (
    <span className={css.stack} aria-hidden data-member-stack="">
      {members.slice(0, 3).map(member => (
        <BotAvatar key={member.id} seed={member.id} className={css.stackAvatar} />
      ))}
    </span>
  )
}

type GroupMemberRowProps = Pick<GroupMembersAsideProps, 'openTeammate' | 't'> & MemberSeats & {
  member: TeamMemberProjection
  onError: (message: string) => void
}

function GroupMemberRow({
  member, sessionId, useSessions, useSessionStatus, openTeammate, onError, t,
}: GroupMemberRowProps) {
  const status = useMemberStatus(member, { useSessions, useSessionStatus })
  const openable = memberOpenable(member, status, sessionId)
  return (
    <Tooltip label={t('open')} side="bottom" gap={4} disabled={!openable}>
      <button
        type="button"
        className={css.member}
        disabled={!openable}
        data-member-status={status}
        onClick={() => {
          try {
            openTeammate(sessionId, member.id)
          } catch (reason) {
            onError(String(reason))
          }
        }}
      >
        <span className={css.avatarSeat}>
          <BotAvatar seed={member.id} className={css.avatar} />
          {status !== 'inactive' && <StateDot state={memberDotState(status)} className={css.statusDot} />}
        </span>
        <span className={css.memberText}>
          <span className={css.memberName}>
            <span className={css.memberNameText}>{memberDisplayName(member, t)}</span>
            {member.role === 'lead' && <Tag tone="info" className={css.roleTag}>{t('member.role.lead')}</Tag>}
          </span>
          <small className={css.memberStatus}>{t(memberStatusKey(status))}</small>
          {member.error !== undefined && <small className={css.diagnostic}>{member.error}</small>}
        </span>
      </button>
    </Tooltip>
  )
}

/**
 * The group chat's pinned member roster: every member with its avatar and
 * live status, a click-through to each teammate's conversation, and the
 * add-member form.
 * @param props - Lead Session seats, injected Team actions, and the Team locale seat.
 * @returns the roster panel.
 */
export function GroupMembersAside({
  sessionId, useSession, useSessions, useSessionStatus, openTeammate, addTeammate, t,
}: GroupMembersAsideProps) {
  const team = useSessions(state => state.projectionsBySession[sessionId]?.values.agentTeam)
  const opening = useSession(snapshot => snapshot.openState === 'loading')
  const listing = useSessions(state => state.phase === 'pending')
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setError(null) }, [sessionId])
  const loading = opening || listing
  return (
    <section className={css.aside} aria-label={t('roster')} data-group-members="">
      <h3 className={css.heading}>
        {t('roster')}
        {team !== undefined && <span className={css.count}>{team.members.length}</span>}
      </h3>
      {error !== null && (
        <div className={css.alert} role="alert"><StateDot state="error" />{error}</div>
      )}
      {team === undefined
        ? (
          <div className={css.notice} role="status">
            <StateDot state={loading ? 'ongoing' : 'warning'} />
            {t(loading ? 'loading' : 'unavailable')}
          </div>
        )
        : (
          <>
            {team.failure !== undefined && (
              <div className={css.alert} role="alert"><StateDot state="error" />{t('failure', { message: team.failure })}</div>
            )}
            <ul className={css.list}>
              {team.members.map(member => (
                <li key={member.id}>
                  <GroupMemberRow
                    member={member}
                    sessionId={sessionId}
                    useSessions={useSessions}
                    useSessionStatus={useSessionStatus}
                    openTeammate={openTeammate}
                    onError={setError}
                    t={t}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      <AddMemberForm sessionId={sessionId} addTeammate={addTeammate} onError={setError} t={t} />
    </section>
  )
}

/**
 * Member setup inside the blank group chat's hero: the bots already added,
 * then the add-member form.
 * @param props - Lead Session seats, the injected creation call, and the Team locale seat.
 * @returns the member chips and form.
 */
export function GroupHeroMembers({ sessionId, useSessions, addTeammate, t }: GroupHeroMembersProps) {
  const members = useSessions(state => state.projectionsBySession[sessionId]?.values.agentTeam?.members)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setError(null) }, [sessionId])
  const bots = members?.filter(member => member.role === 'teammate') ?? []
  return (
    <div className={css.hero} data-group-hero-members="">
      {bots.length > 0 && (
        <ul className={css.chips} aria-label={t('roster')}>
          {bots.map(member => (
            <li key={member.id} className={css.chip} data-member-phase={member.phase}>
              <BotAvatar seed={member.id} className={css.chipAvatar} />
              <span className={css.chipName}>{member.name}</span>
            </li>
          ))}
        </ul>
      )}
      {error !== null && (
        <div className={css.alert} role="alert"><StateDot state="error" />{error}</div>
      )}
      <AddMemberForm sessionId={sessionId} addTeammate={addTeammate} onError={setError} t={t} />
    </div>
  )
}

/**
 * Name the member who sent a relayed message, from the Lead's Team roster.
 * @param props - Lead Session seats, the sender's Session id, and the Team locale seat.
 * @returns the member's display name, or a generic label for a sender outside the roster.
 */
export function GroupSenderName({ sessionId, senderId, useSessions, t }: GroupSenderNameProps) {
  const member = useSessions(state => state.projectionsBySession[sessionId]?.values.agentTeam?.members
    .find(candidate => candidate.id === senderId))
  return <>{member === undefined ? t('member.unknown') : memberDisplayName(member, t)}</>
}
