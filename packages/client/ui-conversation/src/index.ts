/** Host registration for browser conversation preferences. */
import type {} from '@deepseek-ai/dsh-settings'

import type { Volatile, Context } from '@deepseek-ai/cordis'
import type { BusyEnterBehavior } from './submission-settings.ts'
import z from '@deepseek-ai/schemastery'
import { BUSY_ENTER_FIELD, BOT_WORKBENCH_FIELD, BOT_GROUP_PRESET_FIELD } from './submission-settings.ts'

import { ConversationSettingsFields } from './submission-settings.ts'

export {
  BOT_GROUP_PRESET_FIELD, BOT_WORKBENCH_FIELD, BUSY_ENTER_BEHAVIORS, BUSY_ENTER_FIELD, CONVERSATION_SETTINGS_NAMESPACE,
  DEFAULT_BUSY_ENTER_BEHAVIOR, type BusyEnterBehavior, type ConversationSettings,
} from './submission-settings.ts'

/** Runtime preferences projected to the browser. */
export interface Config {
  /** Enter key behavior while a turn is running. */
  busyEnter: Volatile<BusyEnterBehavior>
  /** Whether the blank-session hero presents the Bot workbench chrome. */
  botWorkbench: Volatile<boolean>
  /** Agent preset a new group-chat session selects before it opens; empty offers no group creation. */
  botGroupPreset: Volatile<string>
}

/** Live preferences projected to the browser. */
export const Config = z.object({
  [BUSY_ENTER_FIELD]: ConversationSettingsFields[BUSY_ENTER_FIELD].volatile(),
  [BOT_WORKBENCH_FIELD]: ConversationSettingsFields[BOT_WORKBENCH_FIELD].volatile(),
  [BOT_GROUP_PRESET_FIELD]: ConversationSettingsFields[BOT_GROUP_PRESET_FIELD].volatile(),
})

/** Host preferences are consumed through the configuration form projection.
 * @param ctx Plugin context used for optional settings presentation.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (child) => { child.effect(() => child.settings.configure({ auto: false }, ctx.fiber)) })
}
