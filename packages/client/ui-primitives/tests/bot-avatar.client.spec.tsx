// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { BotAvatar, botAvatarHue } from '@deepseek-ai/dsh-client-ui-primitives'

afterEach(cleanup)

describe('BotAvatar', () => {
  it('derives one stable hue per seed', () => {
    expect(botAvatarHue('')).toBe(0)
    expect(botAvatarHue('session-a')).toBe(botAvatarHue('session-a'))
    expect(botAvatarHue('session-a')).not.toBe(botAvatarHue('session-b'))
    for (const seed of ['a', 'zz', 'a-very-long-session-identifier']) {
      const hue = botAvatarHue(seed)
      expect(hue).toBeGreaterThanOrEqual(0)
      expect(hue).toBeLessThan(360)
    }
  })

  it('renders a decorative robot tinted by its seed', () => {
    const { container } = render(<BotAvatar seed="session-a" className="placed" />)
    const svg = container.querySelector('svg')!
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.dataset['botAvatar']).toBe(String(botAvatarHue('session-a')))
    expect(svg.classList.contains('placed')).toBe(true)
    expect(svg.querySelector('rect[rx="25"]')?.getAttribute('fill')).toBe(`hsl(${botAvatarHue('session-a')} 70% 56%)`)
  })
})
