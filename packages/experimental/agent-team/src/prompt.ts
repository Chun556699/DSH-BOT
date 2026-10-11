import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'

/**
 * Identity and mailbox scaffold prepended to every fresh teammate's first
 * prompt by the model-facing tool and the client Remote call alike.
 * @param name - durable lower-kebab-case teammate name.
 * @returns one text block naming the teammate, its Lead, and the send targets.
 */
export function teammateIdentityReminder(name: string): ContentBlock {
  return {
    type: 'text',
    text: `<system-reminder>
You are teammate "${name}".
Your Team Lead is named "lead".
Use list_agents({}) to find your teammates and their names.
To message your Team Lead, use send_message({ target: "lead", message: "..." }).
To message another teammate, use send_message({ target: "<teammate name>", message: "..." }).
</system-reminder>

`,
  }
}
