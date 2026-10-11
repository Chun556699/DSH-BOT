---
description: "Durable personal memory store plus the bot_memory tool (save/search/delete) over the storage-domain layer, scoped shared or per-session."
kind: "package-reference"
---

# @deepseek-ai/dsh-bot-memory

English | [中文](README.zh.md)

## Summary

Use `dsh-bot-memory` to give agents a durable personal memory store through the `bot_memory` tool. Records persist in the `bot_memory` storage domain — one private deployment-local store under the DSH home, one JSON document per record — and survive restarts. A `shared` record is visible to every session in the deployment; a `session` record is private to its owning session and can never leak into another session's searches or deletes. Nothing is injected into prompts: the model sees only memories it explicitly searched for, and the store is not a secrets vault.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Add the row to a composition whose agents should carry memories across conversations; `packages/interaction/bot-policy` gates its save and delete actions when the deployment requires one-time approval.

### When to choose it

Choose it for a personal deployment where the agent should retain useful context across sessions. It is a private single-operator store, not a shared team knowledge base.

### The one tool

- `bot_memory(action, <content|query|id>, <scope|limit>)` — `save` stores `content` (non-empty, at most 2048 UTF-8 bytes) as `shared` by default or `session`-private. `search` does a case-insensitive literal substring match, newest `updatedAt` first, at most 10 results (`limit` 1–10, default 5); omit `query` to list recent accessible memories. `delete` removes one accessible record; unknown or inaccessible ids return `deleted: false` identically.

### Minimal configuration

```yaml
- name: '@deepseek-ai/dsh-bot-memory'
```

`maxRecords` (default 1000, range 1–10000) is an admission ceiling: a full store refuses new saves with `capacity_reached` and never evicts.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The plugin opens the `bot_memory` domain (version 1, per-record layout) through `ctx.storageDomain`, so the mounted backend owns durability — `storage-json` in the shipped compositions. Every operation requires a live calling Agent verified against `ctx.agents`; session scope derives `ownerSession` from `agent.session.id`, never from arguments. Mutation admission serializes so concurrent saves cannot race the ceiling, and each queued write re-checks cancellation inside its slot. Disposal drains admitted writes before the domain closes. Invalid action/argument combinations return `invalid_arguments`; backend write failures return `internal_error` without claiming success.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `bot_memory` registration, admission serialization, scope enforcement, render/present helpers |
| [`src/spec.ts`](src/spec.ts) | Domain spec and durable record schema (scope/owner consistency, byte ceiling) |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Storage domain service](../storage-domain/README.md) — the domain/table facility this package opens.
- [Bot policy](../../interaction/bot-policy/README.md) — the approval gate that turns memory writes into one-time asks.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The generated [`bot_memory` schema](../../../docs/tool-catalog.md#deepseek-aidsh-bot-memory) whenever this package is mounted: one `action` enum plus `content`, `query`, `id`, `scope`, `limit`, with the description stating shared-versus-session visibility and the no-secrets rule.

#### Token effect

A fixed schema cost on every request while mounted.

#### KV Cache effect

Prefix-stable while the tool definition is unchanged.

### Memory results

#### What the model sees

One JSON text block per call: `{action, memories[]}` for save/search, `{action, memories: [], deleted}` for delete, or `{code, message}` with a stable error code.

#### Token effect

Search results stay in the calling session's history until compaction; a `limit`-sized page repeats on later requests.

#### KV Cache effect

Append-only; newly returned content does not invalidate the prefix.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Literal search only** — matching is case-insensitive substring; there is no embedding, ranking, or fuzzy recall.
- **No automatic injection** — memories never enter a prompt unrequested; the agent must call `search` itself.
- **A full store refuses writes** — `capacity_reached` is the only signal; there is no eviction, truncation, or compaction pass.
- **Requires a live calling Agent** — host-side or agent-less callers receive `agent_required`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
