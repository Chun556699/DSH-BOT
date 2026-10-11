import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import * as HostPlugin from '../src/index.ts'
import { liveConfig, omitsGeneratedPage } from '../../../settings/settings/tests/live-config.ts'
import { plainConfig } from '../../../settings/settings/src/schema.ts'
import {
  DEFAULT_BUSY_ENTER_BEHAVIOR, Config, apply,
} from '@deepseek-ai/dsh-client-ui-conversation'


describe('ui-conversation host', () => {
  it('registers, validates, and disposes the durable busy-Enter preference', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    const { fiber } = configuration
    expect(plainConfig(configuration.fiber.config)).toEqual({
      busyEnter: DEFAULT_BUSY_ENTER_BEHAVIOR, botWorkbench: false, botGroupPreset: '',
    })
    await configuration.update({ busyEnter: 'steer' })
    expect(plainConfig(configuration.fiber.config)).toEqual({ busyEnter: 'steer', botWorkbench: false, botGroupPreset: '' })
    await expect(configuration.update({ busyEnter: 'invalid' })).rejects.toThrow()
    await fiber.dispose()
  })

  it('defaults the Bot workbench opt-in to false and validates it', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    const { fiber } = configuration
    await configuration.update({ botWorkbench: true })
    expect(plainConfig(configuration.fiber.config)).toEqual({ busyEnter: 'queue', botWorkbench: true, botGroupPreset: '' })
    await expect(configuration.update({ botWorkbench: 'yes' })).rejects.toThrow()
    await fiber.dispose()
  })

  it('carries the group-chat preset field as a volatile string', async () => {
    const ctx = new Context()
    const configuration = await liveConfig(ctx, { Config, apply })
    const { fiber } = configuration
    await configuration.update({ botGroupPreset: 'bot-group' })
    expect(plainConfig(configuration.fiber.config)).toEqual({ busyEnter: 'queue', botWorkbench: false, botGroupPreset: 'bot-group' })
    await expect(configuration.update({ botGroupPreset: 7 })).rejects.toThrow()
    await fiber.dispose()
  })
})

it('keeps its own instance off the generated Settings pages', () => omitsGeneratedPage(ctx => ctx.plugin(HostPlugin)))
