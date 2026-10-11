// The Bot workbench is an opt-in blank-session hero: deployment-selected chrome
// (small brand + headline). It owns no composer — ConversationContent keeps the
// single resident input bar, so the textarea DOM survives the hero → active
// transition exactly as upstream.

import type { ConversationContentProps } from '../contract/slots.ts'
import css from './BotWorkbench.module.css'

/** The owner's locale seat, shared with the upstream hero chrome. */
type BotTranslate = ConversationContentProps['t']

/** Bot hero chrome props; the owner passes its locale seat down as a plain prop. */
export interface BotWorkbenchHeroProps {
  /** The owner's locale seat. */
  t: BotTranslate
}

/**
 * The Bot hero chrome: the small uppercase product brand above a localized
 * headline. It replaces only the default hero presentation; the workspace row
 * and resident composer stay owned by ConversationContent.
 * @param props - locale seat.
 * @returns the centered Bot brand and headline.
 */
export function BotWorkbenchHero({ t }: BotWorkbenchHeroProps) {
  return (
    <div className={css.hero}>
      <span className={css.brand}>{t('bot.hero.brand')}</span>
      <span className={css.headline}>{t('bot.hero.headline')}</span>
    </div>
  )
}

/** The small routing line under the Bot hero composer. */
export function BotComposerHint({ t }: BotWorkbenchHeroProps) {
  return <div className={css.composerHint}>{t('bot.composer.hint')}</div>
}
