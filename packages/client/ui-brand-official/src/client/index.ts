/**
 * Official product branding for slot-driven surfaces.
 * The official build profile fills `sidebar.brand.mark` and
 * `sidebar.brand.name` with the shipped artwork; other profiles keep the
 * surface's own fallbacks. A deployment selecting the Bot product replaces
 * the sidebar name with the localized product text — registration follows
 * the live Host brand section, so it applies whether the section lands
 * before or after this plugin.
 * @module @deepseek-ai/dsh-client-ui-brand-official/client
 */
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'

import type { Context } from '@deepseek-ai/cordis'
import { BotBrandName, OfficialBrandMark, OfficialBrandName } from './Brand.tsx'
import { en, zh, NS, type BrandOfficialKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Product names for non-official brand occupants. */
    'brand-official': BrandOfficialKey
  }
}

/** Settings namespace serving the brand-official Host entry. */
const BRAND_SETTINGS_NAMESPACE = 'ui-brand-official'

/** The Host brand section projected through the settings mirror. */
interface BrandSettings {
  /** Which product chrome the brand occupants present. */
  product?: 'harness' | 'bot'
}

/** Services this plugin requires. */
export const inject = ['slots']

/**
 * Whether this document was bundled for the official product build.
 * @returns true when the official artwork belongs in the brand slots.
 */
function officialBuild(): boolean {
  return process.env.DSH_CLIENT_BUILD_PROFILE === 'official'
}

/**
 * Fill the sidebar brand slots for the official product build, or follow the
 * Host brand section for the Bot product name. Both surfaces keep their own
 * fallbacks when neither applies.
 * @param ctx - Client root context.
 */
export function apply(ctx: Context): void {
  const slots = ctx.slots
  // The official wordmark is a fixed artwork choice for the official build.
  if (officialBuild()) {
    ctx.effect(function* () {
      yield ctx.slots.inject('sidebar.brand.mark', () =>
        ctx.slots.inject('sidebar.brand.name', function* () {
          yield slots.register({ name: 'sidebar.brand.mark' }, OfficialBrandMark)
          yield slots.register({ name: 'sidebar.brand.name' }, OfficialBrandName)
        }))
    }, 'ui-brand-official: brand occupants')
  }

  // The Bot product name is a composition choice: it follows the live Host
  // brand section projected through the settings mirror, so it appears and
  // disappears with configuration while this plugin stays mounted.
  ctx.inject(['configForms', 'locale'], (scoped) => {
    scoped.effect(() => scoped.locale.register(NS, { en, zh }), 'ui-brand-official: dictionaries')
    const form = scoped.configForms.get<BrandSettings>(BRAND_SETTINGS_NAMESPACE)
    let disposer: (() => void) | undefined
    const sync = (): void => {
      const bot = form.getSnapshot().value?.product === 'bot'
      if (bot && disposer === undefined) {
        disposer = slots.inject('sidebar.brand.name', () =>
          slots.register({ name: 'sidebar.brand.name', locale: NS }, BotBrandName))
      } else if (!bot && disposer !== undefined) {
        disposer()
        disposer = undefined
      }
    }
    scoped.effect(() => {
      const unsubscribe = form.subscribe(sync)
      sync()
      return () => { unsubscribe(); disposer?.() }
    }, 'ui-brand-official: product selection')
  })
}
