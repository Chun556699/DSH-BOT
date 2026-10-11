// BotAvatar: the "Minimal" assistant-robot geometry from botspark.ai (free,
// no attribution required), recropped to the robot's bounding box. The tint
// is derived from a stable seed, so every surface that draws the same bot
// (sidebar row, chat sender, member roster) shows the same color.

import clsx from 'clsx'
import css from './BotAvatar.module.css'

/**
 * Derive the avatar hue for one bot identity.
 * @param seed - stable identity, such as the bot's Session id.
 * @returns a hue in degrees, `0` through `359`.
 */
export function botAvatarHue(seed: string): number {
  let hue = 0
  for (const ch of seed) hue = (hue * 31 + ch.charCodeAt(0)) % 360
  return hue
}

/**
 * Render a decorative, seed-tinted robot avatar that fills its box. The
 * render site sizes it and names the bot in adjacent text.
 * @param props.seed - stable identity whose hue tints the robot.
 * @param props.className - extra class for size and placement.
 * @returns the `aria-hidden` avatar element.
 */
export function BotAvatar({ seed, className }: {
  seed: string
  className?: string | undefined
}) {
  const hue = botAvatarHue(seed)
  // The tint is computed per identity, so it cannot be a fixed theme token.
  const body = `hsl(${hue} 70% 56%)`
  const face = `hsl(${hue} 80% 94%)`
  const antenna = `hsl(${hue} 55% 40%)`
  return (
    <svg className={clsx(css.avatar, className)} viewBox="25 25 150 150" aria-hidden data-bot-avatar={hue}>
      <circle cx="100" cy="38" r="8" fill={antenna} />
      <rect x="97" y="38" width="6" height="18" fill={antenna} />
      <rect x="50" y="50" width="100" height="120" rx="25" fill={body} />
      <circle cx="80" cy="95" r="8" fill={face} />
      <circle cx="120" cy="95" r="8" fill={face} />
      <rect x="80" y="130" width="40" height="6" rx="3" fill={face} />
    </svg>
  )
}
