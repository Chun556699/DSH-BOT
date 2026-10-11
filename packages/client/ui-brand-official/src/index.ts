/**
 * Host entry for the official-branding client package.
 * `product` selects which product chrome the client slot occupants present;
 * volatile so the browser reads it through the settings projection rather
 * than a build-time constant.
 * @module @deepseek-ai/dsh-client-ui-brand-official
 */
import type {} from '@deepseek-ai/dsh-settings'
import type { Context, Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

/** Product chrome variants the brand occupants know. */
export type BrandProduct = 'harness' | 'bot'

/**
 * Brand presentation settings projected to the browser.
 * `product` selects the sidebar brand name the client registers: `harness`
 * keeps the official artwork and wordmark, `bot` renders the DeepSeek Bot
 * product name in the same slot.
 */
export interface Config {
  /** Which product chrome the brand occupants present. */
  product: Volatile<BrandProduct>
}

/** Live brand preferences projected to the browser. */
export const Config = z.object({
  product: z.union(['harness', 'bot']).default('harness').volatile(),
})

/**
 * The brand namespace has no generated settings page: `product` is a
 * composition value, not a user preference.
 * @param ctx - Plugin context used for optional settings presentation.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
