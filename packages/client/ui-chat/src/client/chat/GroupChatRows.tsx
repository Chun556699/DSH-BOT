/** Group-chat rows: a bot's avatar-and-name header and relayed agent messages as chat bubbles. */
import { useMemo, type ReactNode } from 'react'
import { BotAvatar, JsonBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import type { ContextMessageNode } from '../contract/snapshot.ts'
import { markdownLabels } from '../markdown-labels.ts'
import { formatMessageClock } from './message-chrome.ts'
import type { RelaySender } from './turn-trigger.ts'
import css from './GroupChatRows.module.css'

/**
 * Head the content one bot posts with its seed-tinted avatar and name.
 * @param props.seed - stable bot identity, shared with every other avatar of that bot.
 * @param props.name - localized or resolved display name.
 * @param props.children - trailing header content, such as a time or the Turn control.
 * @returns the speaker header row.
 */
export function GroupSpeaker({ seed, name, children }: {
  seed: string
  name: ReactNode
  children?: ReactNode
}) {
  return (
    <div className={css.speaker} data-group-speaker="">
      <BotAvatar seed={seed} className={css.avatar} />
      <span className={css.name}>{name}</span>
      {children}
    </div>
  )
}

/**
 * Render a message another agent sent to this Session as a left-aligned chat
 * bubble under its sender. The bubble keeps the model-facing text verbatim.
 * @param props.sender - authoring agent recorded by the message source.
 * @param props.content - durable message blocks.
 * @param props.time - Unix epoch ms of the message event.
 * @param props.renderSender - sender-label slot renderer; absence shows the generic agent label.
 * @param props.t - the owning view's locale seat.
 * @returns the relayed-message bubble.
 */
export function GroupRelayBubble({ sender, content, time, renderSender, t }: {
  sender: RelaySender
  content: ContextMessageNode['content']
  time: number
  renderSender: ChatNodeOwnerProps['renderSender']
  t: ChatViewSlotProps['t']
}) {
  const labels = useMemo(() => markdownLabels(t), [t])
  const text = content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n\n')
  const rest = content.filter(block => block.type !== 'text')
  const name = sender.name ?? (renderSender === undefined ? t('group.sender.agent') : renderSender({ senderId: sender.id }))
  return (
    <section className={css.relay} data-group-relay="">
      <GroupSpeaker seed={sender.id} name={name}>
        <time className={css.time} dateTime={new Date(time).toISOString()}>{formatMessageClock(time, t)}</time>
      </GroupSpeaker>
      <div className={css.bubble}>
        {text !== '' && <MarkdownText text={text} labels={labels} />}
        {rest.map((block, index) => (
          <JsonBlock key={index} label={t('message.extraBlock')} payload={block}
            truncatedLabel={total => t('json.truncated', { total })} />
        ))}
      </div>
    </section>
  )
}
