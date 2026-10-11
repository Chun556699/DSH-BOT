// @vitest-environment jsdom
import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { SlotRegistry } from '@deepseek-ai/dsh-client-ui-renderer/client'
import { createSnapshotStore, type ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { apply, inject } from '../src/client/index.ts'
import { BotBrandName, OfficialBrandMark, OfficialBrandName } from '../src/client/Brand.tsx'
import { apply as hostApply } from '../src/index.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
})

const HOLES = [
  'sidebar.brand.mark',
  'sidebar.brand.name',
] as const

const HERO_HOLE = 'conversation.hero.brand.mark'

async function bench(declare = true) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  const declareHoles = () => slots.register({
    name: 'root',
    children: Object.fromEntries([...HOLES, HERO_HOLE].map(name => [name, { kind: 'single', scope: 'root' }])),
  } as never, () => null)
  const disposeHoles = declare ? declareHoles() : undefined
  return { ctx, slots, declareHoles, disposeHoles }
}

/** Minimal Host-side brand section projected through a form-like face. */
function brandForm(product: ObservableSnapshot<'harness' | 'bot'>) {
  return {
    getSnapshot: () => ({ value: { product: product.getSnapshot() } }),
    subscribe: (listener: () => void) => product.subscribe(listener),
  }
}

/** Provide the configForms and locale services the bot-brand path consumes. */
function productServices(ctx: Context, product: ObservableSnapshot<'harness' | 'bot'>) {
  const form = brandForm(product)
  ctx.provide('configForms', { get: () => form })
  ctx.provide('locale', { register: () => () => {}, bind: () => (key: string) => key })
  return form
}

describe('official browser-brand plugin', () => {
  it('keeps the host Loader entry inert', () => {
    expect(() => hostApply(new Context())).not.toThrow()
  })

  it('declares only the slot service it uses', () => {
    expect(inject).toEqual(['slots'])
  })

  it('leaves every slot empty outside the official build profile', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'local')
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(subject.slots.entries(hole)).toHaveLength(0)
  })

  it('fills declarations before or after apply and removes every occupant on teardown', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const before = await bench()
    const fiber = before.ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    before.disposeHoles?.()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)
    before.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(1)

    await fiber.dispose()
    for (const hole of HOLES) expect(before.slots.entries(hole)).toHaveLength(0)

    const after = await bench(false)
    await after.ctx.plugin({ inject: [...inject], apply }).await()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(0)
    after.declareHoles()
    await Promise.resolve()
    for (const hole of HOLES) expect(after.slots.entries(hole)).toHaveLength(1)
  })

  it('leaves the conversation hero on its declaring fallback even in official builds', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'official')
    const subject = await bench()
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    expect(subject.slots.entries(HERO_HOLE)).toHaveLength(0)
  })

  it('renders the official name independently from both requested mark sizes', () => {
    const name = render(<OfficialBrandName />)
    expect(name.container.querySelector('svg')?.getAttribute('viewBox')).toBe('26 0 156 24')
    name.unmount()

    const mark = render(<OfficialBrandMark size={34} />)
    expect(mark.container.querySelector('svg')?.getAttribute('width')).toBe('34')
    mark.rerender(<OfficialBrandMark size={24} />)
    expect(mark.container.querySelector('svg')?.getAttribute('width')).toBe('24')
  })
})

describe('bot product brand', () => {
  it('registers the bot sidebar name when the Host brand section selects bot', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'local')
    const subject = await bench()
    const product = createSnapshotStore<'harness' | 'bot'>('bot')
    productServices(subject.ctx, product)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    await Promise.resolve()
    expect(subject.slots.entries('sidebar.brand.name')).toHaveLength(1)
    expect(subject.slots.entries('sidebar.brand.mark')).toHaveLength(0)
  })

  it('follows the product selection live and disposes when it leaves bot', async () => {
    vi.stubEnv('DSH_CLIENT_BUILD_PROFILE', 'local')
    const subject = await bench()
    const product = createSnapshotStore<'harness' | 'bot'>('harness')
    productServices(subject.ctx, product)
    await subject.ctx.plugin({ inject: [...inject], apply }).await()
    await Promise.resolve()
    expect(subject.slots.entries('sidebar.brand.name')).toHaveLength(0)

    product.set('bot')
    await Promise.resolve()
    expect(subject.slots.entries('sidebar.brand.name')).toHaveLength(1)

    product.set('harness')
    await Promise.resolve()
    expect(subject.slots.entries('sidebar.brand.name')).toHaveLength(0)
  })

  it('renders the bot name through its locale seat', () => {
    const view = render(<BotBrandName t={key => key === 'product.bot' ? 'DeepSeek Bot' : key} />)
    expect(view.getByText('DeepSeek Bot')).toBeTruthy()
    view.unmount()
  })
})
