import { BrandWordmark, FishLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import css from './Brand.module.css'

/**
 * Render the official mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the official whale mark.
 */
export function OfficialBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <FishLogo size={size} />
}

/**
 * Render the official name artwork without its independently slotted mark.
 * @returns the official name wordmark.
 */
export function OfficialBrandName() {
  return <BrandWordmark includeMark={false} />
}

/**
 * The Bot product's sidebar brand name — plain text where the official
 * wordmark sits. The mark slot is left to the standard fallback.
 * @param props - locale seat bound to the `brand-official` namespace.
 * @returns the localized product name.
 */
export function BotBrandName({ t }: { t: TranslateNS<'brand-official'> }) {
  return <span className={css.botName}>{t('product.bot')}</span>
}
