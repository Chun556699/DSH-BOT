---
description: "Pre-execute policy for the Bot composition: turns consequential tool calls (shell, schedule, memory writes, browser) into one-time user approvals."
kind: "package-reference"
---

# @deepseek-ai/dsh-bot-policy

English | [中文](README.zh.md)

## Summary

Use `dsh-bot-policy` to put the DeepSeek Bot's consequential operations behind the existing user-approval channel. It prepends one `tools/pre-execute` listener that consults every later listener first, retains upstream denials, cancellations, and asks untouched, and only turns a clean `allow` into a one-time `ask` — for every `bash`/`pwsh` call, every `schedule_create`/`schedule_update`/`schedule_delete`, every `bot_memory` save or delete, and every tool name matching the configured browser prefixes. Each gated call asks its own approval; a grant is never reused.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

Insert one row in a composition that pairs the existing approval service with stronger per-call consent:

```yaml
- name: '@deepseek-ai/dsh-bot-policy'
```

`browserToolPrefixes` (default `['mcp__playwright-mcp__', 'mcp__chrome-devtools-mcp__']`, must stay non-empty) names the tool prefixes treated as browser operations.

### When to choose it

Choose it for a deployment where the agent may read and plan freely, but persistent or consequential actions need an explicit human click each time.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The listener registers `{ prepend: true }`, then awaits `next()` before deciding: a downstream `deny`, `cancel`, or `ask` returns unchanged, so policy can only strengthen — never weaken — another guard. A downstream `allow` becomes `{ kind: 'ask', reason, displayReason }` whose display reason carries direct English and Chinese text for the approval UI. The ToolRuntime routes each ask through the approval service for that call only: `allowed-once` proceeds once, `rejected`/`cancelled`/`unavailable` all deny, and a missing approval service denies outright. Calls outside the gated set — reads, `bot_memory` search, and every tool not listed above — pass through unchanged. Disposing the plugin removes the listener, so subsequent calls gate nothing.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the prepended gate, gated-name matching, and approval copy |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Tool runtime](../../core/tools/README.md) — the `tools/pre-execute` waterfall this listener joins.
- [User approval](../user-approval/README.md) — the service that answers each `ask`.
- [Bot memory](../../storage/bot-memory/README.md) — the store whose writes this gate covers.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package registers no tools and only changes pre-execute decisions.

#### KV Cache effect

Approval policy contributes no provider request content.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Name-based coverage** — the gate matches tool names and configured prefixes; a shell-command surface registered under a different name needs its own entry in `browserToolPrefixes` or the shell-name set is incomplete for that deployment.
- **One-time only** — the gate deliberately offers no allow-always; a deployment wanting reusable grants composes the existing approval service's own policies instead.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
