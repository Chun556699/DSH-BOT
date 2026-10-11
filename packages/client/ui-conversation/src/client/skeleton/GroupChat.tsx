// Group-chat chrome for the Lead view of a Session on the deployment's
// group-chat preset. Like the Bot workbench hero it owns no composer:
// ConversationContent keeps the single resident input bar.

import { IconUsersOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConversationContentProps } from '../contract/slots.ts'
import css from './GroupChat.module.css'

/**
 * Decide whether a Session view presents group-chat chrome.
 * @param groupPreset - deployment group-chat preset, or undefined when none is offered.
 * @param sessionPreset - preset the Session committed, when known.
 * @param teammate - whether the view shows a teammate child rather than the Lead.
 * @returns true only for the Lead view of a Session on the group-chat preset.
 */
export function isGroupChatLead(
  groupPreset: string | undefined,
  sessionPreset: string | null | undefined,
  teammate: boolean,
): boolean {
  return groupPreset !== undefined && sessionPreset === groupPreset && !teammate
}

/** Group hero props; the owner passes its locale and slot seats down as plain props. */
export interface GroupChatHeroProps {
  /** The owner's locale seat. */
  t: ConversationContentProps['t']
  /** The owner's slot renderer, used for the member-setup seat. */
  renderSlot: ConversationContentProps['renderSlot']
}

/**
 * The blank group chat's hero: a members glyph, the group headline and its
 * explanation, then the member-setup seat an Agent Teams plugin occupies.
 * @param props - locale and slot seats.
 * @returns the centered group hero chrome.
 */
export function GroupChatHero({ t, renderSlot }: GroupChatHeroProps) {
  return (
    <div className={css.hero} data-group-chat-hero="">
      <span className={css.glyph} aria-hidden><IconUsersOutlineRegular size={22} /></span>
      <span className={css.headline}>{t('group.hero.title')}</span>
      <span className={css.subtitle}>{t('group.hero.subtitle')}</span>
      <div className={css.members}>{renderSlot('conversation.hero.group', {})}</div>
    </div>
  )
}

/** The routing line under the group hero composer. */
export function GroupComposerHint({ t }: Pick<GroupChatHeroProps, 't'>) {
  return <div className={css.composerHint}>{t('group.composer.hint')}</div>
}
