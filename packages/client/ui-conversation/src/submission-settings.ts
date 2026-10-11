/** Busy-Enter preference stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the conversation plugin. */
export const CONVERSATION_SETTINGS_NAMESPACE = 'ui-conversation'

/** Field carrying the delivery mode for plain Enter while an agent is busy. */
export const BUSY_ENTER_FIELD = 'busyEnter'

/** Busy-Enter behaviors accepted at settings and input boundaries. */
export const BUSY_ENTER_BEHAVIORS = ['queue', 'steer'] as const

/** Configurable meaning of plain Enter while the addressed agent is busy. */
export type BusyEnterBehavior = typeof BUSY_ENTER_BEHAVIORS[number]

/** Default preserves Enter-as-Queue for running conversations. */
export const DEFAULT_BUSY_ENTER_BEHAVIOR: BusyEnterBehavior = 'queue'

/** Field carrying the DeepSeek Bot workbench opt-in. */
export const BOT_WORKBENCH_FIELD = 'botWorkbench'

/** Field carrying the agent preset the Bot workbench assigns to group-chat sessions. */
export const BOT_GROUP_PRESET_FIELD = 'botGroupPreset'

/** Durable conversation section shared by the Host schema and the browser scope. */
export interface ConversationSettings {
  /** Delivery mode for plain Enter while the addressed agent is busy. */
  busyEnter: BusyEnterBehavior
  /**
   * Whether the Bot workbench hero and task cards replace the default
   * blank-session hero chrome; deployments compose it through configuration.
   */
  botWorkbench?: boolean
  /**
   * Agent preset a new group-chat session selects before it opens; an empty
   * value means the deployment offers no group-chat creation.
   */
  botGroupPreset?: string
}

/** Durable conversation schema; also the wire envelope the browser scope validates against. */
export const ConversationSettingsFields = {
  [BUSY_ENTER_FIELD]: z.union([...BUSY_ENTER_BEHAVIORS]).default(DEFAULT_BUSY_ENTER_BEHAVIOR),
  [BOT_WORKBENCH_FIELD]: z.boolean().default(false),
  [BOT_GROUP_PRESET_FIELD]: z.string().default(''),
}

/** Schema for shared configuration values. */
export const ConversationSettingsSchema = z.object(ConversationSettingsFields)
