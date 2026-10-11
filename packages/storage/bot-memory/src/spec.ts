/** Memory domain spec for the Bot memory plugin. @module */
import { z } from 'zod'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'

/** UTF-8 byte ceiling for one memory record, enforced by the durable schema. */
export const MEMORY_CONTENT_MAX_BYTES = 2048

/** One retained memory record in this personal deployment. */
export const MemoryRecordSchema = z.object({
  /** New record identifier (UUIDv4). */
  id: z.uuid(),
  /** Non-empty memory text; at most 2048 UTF-8 bytes. */
  content: z.string().min(1).refine(value => Buffer.byteLength(value, 'utf8') <= MEMORY_CONTENT_MAX_BYTES),
  /** Whether every session in this deployment can see the record. */
  scope: z.enum(['shared', 'session']),
  /** Owning Session when `scope` is `session`; required then, absent otherwise. */
  ownerSession: z.string().transform(value => SessionId(value)).optional(),
  /** Unix milliseconds of the latest write. */
  updatedAt: z.number().int().nonnegative(),
}).superRefine((record, issue) => {
  if (record.scope === 'session' && record.ownerSession === undefined) {
    issue.addIssue({ code: 'custom', message: 'session-scope memory requires ownerSession' })
  }
  if (record.scope === 'shared' && record.ownerSession !== undefined) {
    issue.addIssue({ code: 'custom', message: 'shared memory must not carry ownerSession' })
  }
})

/** One retained memory record in this personal deployment. */
export type MemoryRecord = z.infer<typeof MemoryRecordSchema>

/** The Bot memory domain: one private deployment-local store, not per-session state. */
export const botMemorySpec = defineDomain({
  name: 'bot_memory',
  version: 1,
  layout: 'per-record',
  tables: {
    records: domainTable<string, MemoryRecord>(MemoryRecordSchema),
  },
})
