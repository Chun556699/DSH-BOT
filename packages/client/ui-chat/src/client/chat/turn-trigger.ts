/** Presentation of durable non-human messages claimed to begin a Turn. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ContextMessageNode } from '../contract/snapshot.ts'
import type { ChatKey } from '../locale.ts'

/** Existing primitive glyph selected for a Turn trigger's source family. */
export type TurnTriggerIcon = 'agent' | 'github' | 'goal' | 'job' | 'plugin' | 'request' | 'schedule' | 'subagent' | 'team' | 'webhook'

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function field(source: Record<string, unknown>, key: string): string {
  return typeof source[key] === 'string' ? source[key] : ''
}

/** The agent that authored a relayed message, as its durable source records it. */
export interface RelaySender {
  /** Session id of the authoring Agent. */
  readonly id: SessionId
  /** Display name the source recorded, when it recorded one. */
  readonly name: string | undefined
}

/**
 * Identify the authoring agent of a message another agent chose to send.
 * Runtime notices about an agent, such as a settled child, are not its words
 * and return undefined.
 * @param source - durable message source.
 * @returns the sender, or undefined when the source records no authoring agent.
 */
export function relaySenderOf(source: unknown): RelaySender | undefined {
  const fields = record(source)
  switch (field(fields, 'kind')) {
    case 'agent-message': {
      const id = field(fields, 'senderSessionId')
      return id === '' ? undefined : { id: id as SessionId, name: undefined }
    }
    case 'team-message': {
      const id = field(fields, 'senderId')
      const name = field(fields, 'senderName')
      return id === '' ? undefined : { id: id as SessionId, name: name === '' ? undefined : name }
    }
    default:
      return undefined
  }
}

/**
 * Describe a waking message using its recorded source.
 * @param node - durable context, including the original notification body.
 * @returns localized title key and source-family icon.
 */
export function turnTriggerDetails(node: ContextMessageNode): {
  title: ChatKey
  icon: TurnTriggerIcon
} {
  const source = record(node.source)
  const kind = field(source, 'kind')
  let title: ChatKey = 'message.trigger.request'
  let icon: TurnTriggerIcon = 'request'
  switch (kind) {
    case 'goal': {
      title = 'message.trigger.goal'
      icon = 'goal'
      break
    }
    case 'agent-message':
      title = 'message.trigger.agent'
      icon = 'agent'
      break
    case 'team-message':
      title = 'message.trigger.team'
      icon = 'team'
      break
    case 'subagent-settled': {
      title = 'message.trigger.subagent'
      icon = 'subagent'
      break
    }
    case 'webhook': {
      const github = field(source, 'provider') === 'github'
      title = github ? 'message.trigger.github' : 'message.trigger.webhook'
      icon = github ? 'github' : 'webhook'
      break
    }
    case 'schedule':
      title = 'message.trigger.schedule'
      icon = 'schedule'
      break
    case 'tool-jobs':
      title = 'message.trigger.job'
      icon = 'job'
      break
    case 'cordis-host-runner':
      title = 'message.trigger.plugin'
      icon = 'plugin'
      break
    default:
      // Custom sources remain visible without attributing unrecorded identity or success.
      break
  }
  return { title, icon }
}
