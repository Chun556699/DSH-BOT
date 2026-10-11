/** Browser entry registering the Agent Teams conversation-header action and group-chat member surfaces. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import agentTeamsRemote from '@deepseek-ai/dsh-experimental-agent-team/remote'
import { inject, registerAgentTeamUi } from './mount.ts'

export { inject } from './mount.ts'
export type { TeamActionInjected, TeamActionProps } from './TeamAction.tsx'
export type { GroupMembersInjected } from './GroupMembers.tsx'
export type { TeamKey } from './locales.ts'

/**
 * Mount the `agentTeams` Remote namespace and register the Team locale
 * dictionaries plus the conversation-header action under a scoped Context
 * declaring the new namespace.
 * @param ctx - Client Context with the declared `inject` services available.
 * @returns Remote namespace and scoped UI disposer.
 */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(agentTeamsRemote)
  const ui = ctx.inject([...inject, 'remote.agentTeams'], registerAgentTeamUi)
  try { await ui } catch (error) { await ui.dispose(); await disposeRemote(); throw error }
  return async () => { await ui.dispose(); await disposeRemote() }
}
