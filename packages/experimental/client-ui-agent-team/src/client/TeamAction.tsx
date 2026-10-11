import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {
  SpawnTeammateClientRequest,
  TeamMemberProjection,
  TeamTaskView as TeamTask,
} from '@deepseek-ai/dsh-experimental-agent-team/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import {
  IconChevronDownOutlineRegular,
  IconUserOutlineRegular, IconUsersOutlineRegular, StateDot, Tag, Tooltip,
  useAnchoredPosition, useDismissOnOutsidePointer, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  HostObservable, PropsHooks, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AddMemberForm } from './AddMemberForm.tsx'
import { MemberAvatarStack } from './GroupMembers.tsx'
import {
  memberCountLabel, memberDisplayName, memberDotState, memberOpenable, memberStatusKey, useMemberStatus,
} from './member-status.ts'
import { NS, type TeamKey } from './locales.ts'
import css from './TeamAction.module.css'

/** Business actions injected by the browser plugin. */
export interface TeamActionInjected {
  /** Open a roster Session from the current conversation. */
  openTeammate: (sessionId: SessionId, childSessionId: SessionId) => void
  /**
   * Create one teammate through the Lead's Remote call.
   * @param sessionId - Session the panel renders for; the Lead identity is resolved inside.
   * @param request - wire-safe name, description, and optional first instruction.
   * @returns the failure message, or null once the member is provisioned.
   */
  addTeammate: (sessionId: SessionId, request: SpawnTeammateClientRequest) => Promise<string | null>
  hooks: {
    /**
     * The deployment's group-chat Agent preset id; member creation is offered
     * only while the viewed Session carries it. Undefined hides the affordance.
     */
    groupPreset: HostObservable<string | undefined>
  }
}

/** Full props of the Team conversation-header action. */
export type TeamActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & Omit<TeamActionInjected, 'hooks'>
  & PropsHooks<TeamActionInjected['hooks']>
  & PropsLocale<typeof NS>

function statusKey(status: TeamTask['status']): TeamKey {
  switch (status) {
    case 'pending': return 'status.pending'
    case 'in_progress': return 'status.in_progress'
    case 'completed': return 'status.completed'
    /* v8 ignore next -- Team views omit deleted task tombstones. */
    case 'deleted': return 'status.completed'
  }
}

function taskDotState(task: TeamTask): StateDotState {
  switch (task.status) {
    case 'pending': return task.ready ? 'idle' : 'warning'
    case 'in_progress': return 'ongoing'
    case 'completed': return 'done'
    /* v8 ignore next -- Team views omit deleted task tombstones. */
    case 'deleted': return 'idle'
  }
}

type TeamMemberRowProps = Pick<TeamActionProps,
  'sessionId' | 'useSessions' | 'useSessionStatus' | 'openTeammate' | 't'
> & {
  member: TeamMemberProjection
  name: string
  memberCount: number
  onError: (message: string) => void
}

function TeamMemberRow({
  member, name, memberCount, sessionId, useSessions, useSessionStatus, openTeammate, onError, t,
}: TeamMemberRowProps) {
  const model = useSessions(state => state.projectionsBySession[member.id]?.values.modelSelection?.next?.model)
  const status = useMemberStatus(member, { useSessions, useSessionStatus })
  const isCurrent = member.id === sessionId
  const highlightCurrent = isCurrent && memberCount > 1
  const inert = !memberOpenable(member, status, sessionId)

  return (
    <Tooltip label={t('open')} side="bottom" gap={4} disabled={inert}>
      <button
        type="button"
        className={highlightCurrent ? `${css.member} ${css.memberCurrent}` : css.member}
        disabled={inert}
        onClick={() => {
          try {
            openTeammate(sessionId, member.id)
          } catch (reason) {
            onError(String(reason))
          }
        }}
      >
        <span className={css.memberDot}>
          {status === 'inactive'
            ? <IconUserOutlineRegular size={14} className={css.inactiveIcon} />
            : <StateDot state={memberDotState(status)} />}
        </span>
        <span className={css.memberText}>
          <span className={css.memberName}>
            <span className={css.memberNameText}>{name}</span>
            {isCurrent && <Tag tone="info" className={css.currentTag}>{t('current')}</Tag>}
          </span>
          <small>
            {t(memberStatusKey(status))}
            {model !== undefined && (
              <span className={css.memberModel}>{` · ${t('model')}: ${model}`}</span>
            )}
          </small>
          {member.error !== undefined && <small className={css.diagnostic}>{member.error}</small>}
        </span>
      </button>
    </Tooltip>
  )
}

/** Task card with a two-line description clamp expanded from a toggle in the meta row. */
function TaskCard({ task, t }: { task: TeamTask; t: TranslateNS<typeof NS> }) {
  const [expanded, setExpanded] = useState(false)
  const [clamped, setClamped] = useState(false)
  const textRef = useRef<HTMLParagraphElement>(null)
  useLayoutEffect(() => {
    if (expanded) return
    const paragraph = textRef.current
    /* v8 ignore next -- the paragraph mounts in the same commit as the effect. */
    if (paragraph === null) return
    const measure = (): void => { setClamped(paragraph.scrollHeight > paragraph.clientHeight + 1) }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(paragraph)
    return () => { observer.disconnect() }
  }, [task.description, expanded])
  return (
    <article className={css.task}>
      <div className={css.taskTitle}>
        <strong>{task.subject}</strong>
        <span className={css.taskState}>
          <StateDot state={taskDotState(task)} />
          <span>{t(statusKey(task.status))}</span>
        </span>
      </div>
      <p ref={textRef} className={expanded ? undefined : css.clampedDescription}>{task.description}</p>
      <div className={css.meta}>
        {(clamped || expanded) && (
          <button
            type="button"
            className={css.expandToggle}
            aria-expanded={expanded}
            onClick={() => { setExpanded(current => !current) }}
          >
            {t(expanded ? 'task.collapse' : 'task.expand')}
            <IconChevronDownOutlineRegular size={12} className={expanded ? css.expandToggleOpen : undefined} />
          </button>
        )}
        <span>{task.id}</span>
        <span>{t('owner')}: {task.ownerName ?? t('unowned')}</span>
        {task.status === 'pending' && <span>{task.ready ? t('ready') : t('blocked')}</span>}
        {task.blockedBy.length > 0 && <span>{t('blockedBy')}: {task.blockedBy.join(', ')}</span>}
        {task.writeScopes.length > 0 && <span>{t('writeScopes')}: {task.writeScopes.join(', ')}</span>}
        {task.writeScopeWarnings.map(warning => <span key={warning} className={css.warning}>{warning}</span>)}
      </div>
    </article>
  )
}

/** Render the Team roster and read-only task board. */
export function TeamAction({
  sessionId, useSession, useSessions, useSessionStatus, openTeammate, addTeammate, useGroupPreset, t,
}: TeamActionProps) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const triggerLabelRef = useRef<HTMLSpanElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const position = useAnchoredPosition({
    open, anchorRef: triggerRef, panelRef, gap: 5, margin: 16,
  })
  const positioned = position !== null
  const leadSessionId = useSession(snapshot => snapshot.subagent?.address.parentSessionId) ?? sessionId
  const team = useSessions(state => state.projectionsBySession[leadSessionId]?.values.agentTeam)
  const opening = useSession(snapshot => snapshot.openState === 'loading')
  const listing = useSessions(state => state.phase === 'pending')
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pinnedRef = useRef(false)

  const cancelHoverChange = (): void => {
    clearTimeout(hoverTimer.current)
    hoverTimer.current = undefined
  }

  useEffect(() => {
    cancelHoverChange()
    pinnedRef.current = false
    setOpen(false)
    setError(null)
  }, [sessionId])

  useEffect(() => cancelHoverChange, [])

  useLayoutEffect(() => {
    if (open && positioned && pinnedRef.current) panelRef.current?.focus()
  }, [open, positioned])

  const changeOpen = (next: boolean): void => {
    cancelHoverChange()
    if (!next) pinnedRef.current = false
    setOpen(next)
  }

  const scheduleHoverOpen = (): void => {
    cancelHoverChange()
    if (open) return
    const label = triggerLabelRef.current
    /* v8 ignore next -- the label mounts with the trigger that received the hover. */
    if (label === null) return
    // Icon-only trigger (label collapsed by the header container query):
    // hover-open would surprise on such a small target, so only click opens.
    if (getComputedStyle(label).display === 'none') return
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = undefined
      changeOpen(true)
    }, 150)
  }

  const scheduleHoverClose = (): void => {
    cancelHoverChange()
    if (pinnedRef.current) return
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = undefined
      changeOpen(false)
    }, 120)
  }

  useDismissOnOutsidePointer(rootRef, open, changeOpen, panelRef)

  useEffect(() => {
    if (!open) return
    const dismiss = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      cancelHoverChange()
      pinnedRef.current = false
      setOpen(false)
      if (panelRef.current?.contains(document.activeElement)) triggerRef.current?.focus()
    }
    document.addEventListener('keydown', dismiss)
    return () => { document.removeEventListener('keydown', dismiss) }
  }, [open])

  const compact = team !== undefined && team.members.length === 1 && team.tasks.length === 0

  // Member creation belongs to the group-chat surface: the Lead's own view of a
  // Session carrying the configured group preset. Teammate child views and
  // ordinary sessions keep the read-only roster.
  const groupPresetId = useGroupPreset(value => value)
  const sessionPreset = useSessions(state => state.projectionsBySession[sessionId]?.values.agentPreset)
  const groupChat = groupPresetId !== undefined && sessionPreset === groupPresetId && sessionId === leadSessionId
  // The header seat renders the trigger only where it has content: an existing
  // Team (more than the synthetic Lead row) or a group-chat Lead view able to
  // create one, including while its projection still loads. Ordinary single
  // Sessions stay free of an always-empty panel.
  const visible = groupChat || (team !== undefined && team.members.length > 1)
  // A group chat's trigger doubles as its header roster: member avatars and
  // the member count replace the Team icon and label.
  const groupRoster = groupChat ? team?.members : undefined

  if (!visible) return null

  return (
    <div
      ref={rootRef}
      className={css.root}
      data-team-action
      onMouseLeave={scheduleHoverClose}
    >
      <button
        type="button"
        ref={triggerRef}
        onMouseEnter={scheduleHoverOpen}
        className={css.trigger}
        aria-label={t('trigger')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          cancelHoverChange()
          pinnedRef.current = true
          if (!open) changeOpen(true)
          else panelRef.current?.focus()
        }}
      >
        {groupRoster === undefined
          ? <IconUsersOutlineRegular size={14} />
          : <MemberAvatarStack members={groupRoster} />}
        <span ref={triggerLabelRef} className={css.triggerLabel}>
          {groupRoster === undefined ? t('trigger') : memberCountLabel(groupRoster.length, t)}
        </span>
      </button>
      {open && createPortal(
        <div
          ref={panelRef}
          className={compact ? `${css.panel} ${css.panelCompact}` : css.panel}
          style={position ?? { visibility: 'hidden', left: 0, top: 0 }}
          role="dialog"
          tabIndex={-1}
          aria-label={t('trigger')}
          data-team-panel
          onMouseEnter={cancelHoverChange}
          onMouseLeave={scheduleHoverClose}
        >
          <div className={css.body}>
            {error !== null && (
              <div className={css.error} role="alert"><StateDot state="error" />{error}</div>
            )}
            {team === undefined && (
              <div className={css.notice} role="status">
                <StateDot state={opening || listing ? 'ongoing' : 'warning'} />
                {t(opening || listing ? 'loading' : 'unavailable')}
              </div>
            )}
            {team !== undefined && (
              <>
                {team.failure !== undefined && (
                  <div className={css.error} role="alert"><StateDot state="error" />{t('failure', { message: team.failure })}</div>
                )}
                <section>
                  <h3>
                    {t('roster')}
                    {team.members.length > 1 && <span className={css.count}>{team.members.length}</span>}
                  </h3>
                  <div className={css.roster}>
                    {team.members.map(member => (
                      <TeamMemberRow
                        key={member.id}
                        member={member}
                        name={groupChat ? memberDisplayName(member, t) : member.name}
                        memberCount={team.members.length}
                        sessionId={sessionId}
                        useSessions={useSessions}
                        useSessionStatus={useSessionStatus}
                        openTeammate={openTeammate}
                        onError={setError}
                        t={t}
                      />
                    ))}
                  </div>
                  {groupChat && (
                    <AddMemberForm
                      sessionId={sessionId}
                      addTeammate={addTeammate}
                      onError={setError}
                      t={t}
                    />
                  )}
                </section>
                <section>
                  {team.tasks.length === 0
                    ? <p className={css.emptyNotice}>{t('empty')}</p>
                    : (
                      <>
                        <h3>{t('tasks')}<span className={css.count}>{team.tasks.length}</span></h3>
                        <div className={css.tasks}>
                          {team.tasks.map(task => <TaskCard key={task.id} task={task} t={t} />)}
                        </div>
                      </>
                    )}
                </section>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
