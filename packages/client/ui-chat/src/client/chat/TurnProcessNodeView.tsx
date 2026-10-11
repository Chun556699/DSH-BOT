import { memo } from 'react'
import type { TurnLocation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { IconChevronDownOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeViewProps, TurnProcessOwnerProps } from '../contract/slots.ts'
import { turnProcessAlwaysOpen } from '../contract/turn-process.ts'
import { formatRunDuration } from './message-chrome.ts'
import { GroupSpeaker } from './GroupChatRows.tsx'
import a11yCss from './accessibility.module.css'
import css from './TurnProcessNodeView.module.css'

/** Settled Turn duration and process disclosure above its content. */
export const TurnProcessNodeView = memo(function TurnProcessNodeView({
  node, turnProcess, groupChat, sessionId, t,
}: ChatNodeViewProps<'turn-process'>) {
  if (turnProcess === undefined) throw new Error('turn-process node requires Turn process owner state')
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  // A group chat heads every Lead Turn with the Lead's avatar and name; the
  // settled control shrinks to a one-line toggle beside the name.
  if (groupChat === true) {
    return (
      <GroupSpeaker seed={sessionId} name={t('group.lead')}>
        {turn?.status === 'closed' && (
          <SettledTurnControl node={node} turn={turn} turnProcess={turnProcess} className={css.groupToggle} t={t} />
        )}
      </GroupSpeaker>
    )
  }
  if (turn?.status !== 'closed') return null
  return <SettledTurnControl node={node} turn={turn} turnProcess={turnProcess} className={css.root} t={t} />
})

function SettledTurnControl({ node, turn, turnProcess, className, t }: {
  node: ChatNodeViewProps<'turn-process'>['node']
  turn: TurnLocation
  turnProcess: TurnProcessOwnerProps
  className: string | undefined
  t: ChatNodeViewProps<'turn-process'>['t']
}) {
  const open = !turnProcess.foldable || turnProcess.open
  const canCollapse = turnProcess.foldable && turnProcess.hasContent && !turnProcessAlwaysOpen(node)
  const reason = turn.end?.data.reason.kind
  const elapsedMs = turn.start === undefined || turn.end === undefined ? undefined
    : Math.max(1000, turn.end.time - turn.start.time)
  const duration = elapsedMs === undefined || reason === 'aborted' || reason === 'error' ? undefined
    : formatRunDuration(elapsedMs, t)
  // Other end reasons retain elapsed time; only cancellation and failure replace it.
  const label = reason === 'aborted' ? t('message.stopped')
    : reason === 'error' ? t('message.turnProcess.failed')
      : duration === undefined ? t('message.turnProcess.worked')
        : t('message.turnProcess.took')
  const announcement = reason === 'aborted' ? t('message.stopped')
    : reason === 'error' ? t('message.turnProcess.failed')
      : t('message.turnProcess.worked')
  return (
    <>
      <span className={a11yCss.visuallyHidden} role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
      <button
        type="button"
        className={className}
        data-open={open || undefined}
        data-turn-process={node.data.turn}
        data-turn-process-messages={node.data.messageCount}
        data-turn-process-tool-calls={node.data.toolCallCount}
        data-turn-process-subagents={node.data.subagentCount}
        disabled={!canCollapse}
        aria-expanded={turnProcess.hasContent ? open : undefined}
        onClick={(event) => {
          event.currentTarget.focus()
          turnProcess.setOpen(!open)
        }}
      >
        <span className={css.label}>
          {label}
          {duration?.map((part, index) => (
            <span key={index} className={part.numeric ? css.durationNumber : undefined}>{part.text}</span>
          ))}
        </span>
        {canCollapse && <IconChevronDownOutlineRegular className={css.chevron} />}
      </button>
    </>
  )
}
