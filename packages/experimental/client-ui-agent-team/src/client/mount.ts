/** Source-safe Agent Teams browser registration. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-experimental-agent-team/remote'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { GroupHeroMembers, GroupMembersAside, GroupSenderName, type GroupMembersInjected } from './GroupMembers.tsx'
import { TeamAction, type TeamActionInjected } from './TeamAction.tsx'
import { en, NS, zh, type TeamKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent Teams roster and task-board copy. */
    'agent-team': TeamKey
  }
}

/** Required browser services for navigation, slots, remote calls, config, and localized copy. */
export const inject = ['sessions', 'uiWorkspace', 'slots', 'locale', 'remote', 'configForms']

/** The Conversation section field declaring the deployment's group-chat preset. */
interface ConversationChromeSettings {
  /** Agent preset a group-chat creation commits before the Session opens. */
  botGroupPreset?: string
}

/** The configured group-chat preset id, or undefined when the deployment offers none. */
function groupPresetOf(settings: ConversationChromeSettings | undefined): string | undefined {
  const value = settings?.botGroupPreset
  return value === undefined || value === '' ? undefined : value
}

/**
 * Register the Team locale dictionaries, the conversation-header action, and
 * the group-chat member surfaces: the pinned roster aside, the blank-chat
 * member setup, and relayed-message sender names. Every surface reads the
 * Lead Session's `agentTeam` projection from the shared Session store;
 * member creation goes through the `agentTeams` Remote namespace mounted by
 * this plugin's apply.
 * @param ctx - Client Context carrying the injected navigation, locale, slot, remote, and Session services.
 */
export function registerAgentTeamUi(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'client-ui-agent-team: dictionaries')
  const sessions = ctx.sessions
  const leadSessionId = (sessionId: SessionId): SessionId => {
    const address = sessions.binding(sessionId)?.session.getSnapshot().subagent?.address
    return address?.parentSessionId ?? sessionId
  }

  const conversationSettings = ctx.configForms.get<ConversationChromeSettings>('ui-conversation')
  const groupPreset: HostObservable<string | undefined> = {
    getSnapshot: () => groupPresetOf(conversationSettings.getSnapshot().value),
    subscribe: listener => conversationSettings.subscribe(listener),
  }

  const memberActions: GroupMembersInjected = {
    openTeammate(sessionId: SessionId, childSessionId: SessionId): void {
      const parentSessionId = leadSessionId(sessionId)
      if ((sessions.retainInfo(sessionId).getSnapshot().retainedBy.mainView ?? 0) === 0) return
      if (childSessionId === parentSessionId) {
        ctx.uiWorkspace.openSession(parentSessionId)
        return
      }
      ctx.uiWorkspace.openSession({
        parentSessionId,
        childSessionId,
        mode: 'continuable',
      })
    },
    async addTeammate(sessionId: SessionId, request): Promise<string | null> {
      const result = await ctx.remote.agentTeams.spawnTeammate(leadSessionId(sessionId), request)
      return result.ok ? null : result.error.message
    },
  }
  const actions: TeamActionInjected = { ...memberActions, hooks: { groupPreset } }

  ctx.slots.inject(
    'conversation.session.header.actions',
    () => ctx.slots.register({
      name: 'conversation.session.header.actions',
      id: 'agent-team',
      order: -20,
      locale: NS,
      inject: () => actions,
    }, TeamAction),
  )
  ctx.slots.inject(
    'conversation.session.aside',
    () => ctx.slots.register({
      name: 'conversation.session.aside',
      id: 'agent-team-members',
      locale: NS,
      inject: () => memberActions,
    }, GroupMembersAside),
  )
  ctx.slots.inject(
    'conversation.hero.group',
    () => ctx.slots.register({
      name: 'conversation.hero.group',
      locale: NS,
      inject: () => ({ addTeammate: memberActions.addTeammate }),
    }, GroupHeroMembers),
  )
  ctx.slots.inject(
    'conversation.chat.sender',
    () => ctx.slots.register({ name: 'conversation.chat.sender', locale: NS }, GroupSenderName),
  )
}
