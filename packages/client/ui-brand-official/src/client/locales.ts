/** Dictionary namespace for the brand-official plugin. */
export const NS = 'brand-official'

/** Product names presented by the non-official brand occupants. */
export const zh = {
  'product.bot': 'DeepSeek Bot',
}

/** Keys the locale seat exposes to brand occupants. */
export type BrandOfficialKey = keyof typeof zh

export const en = {
  'product.bot': 'DeepSeek Bot',
} satisfies Record<BrandOfficialKey, string>
