# DeepSeek Bot

English | [中文](deepseek-bot.zh.md)

DeepSeek Bot is an opt-in composition over the shipped `web` profile: a Bot workbench hero, a durable personal memory tool, a one-time-approval policy for consequential tool calls, and group chats where several bots collaborate under a Master Bot. It adds no application binary and no new server; everything runs through the same `dsh web` runtime, sessions, workspaces, and navigation.

## Prerequisites

- A working checkout of this repository with `pnpm install` completed.
- A DeepSeek API key in the credential store, as for any `dsh web` run. Without a key the page opens in its setup state; the Bot still needs no additional configuration.

## Start

```sh
pnpm run dev:bot      # build, then serve and watch client bundles
pnpm run start:bot    # serve the already-built bundle
```

Both commands run `dsh web --patch apps/cli/config/examples/bot/bot.patch.yml`, bound to loopback only (`127.0.0.1:3080` unless the launch flags say otherwise).

## Desktop

```sh
pnpm run dev:bot:desktop      # build, then launch the Electron development shell
pnpm run start:bot:desktop    # launch with the already-built bundles
```

Both commands apply `bot.patch.yml` to the `desktop` profile — the same Bot workbench, sessions, and group chats inside the Electron window. The desktop dev script also takes repeatable `--patch <file>` flags for other overlays.

## What the Bot does

- The blank-session view shows the `DEEPSEEK BOT` hero over the ordinary composer; the composer stages nothing until you type it.
- `bot_memory` lets the agent save, search, and delete memories in a private store under `$DSH_HOME/storages`. Shared memories are visible to every session in this deployment; session-scoped memories are private to their session. The store is a memory, not a secrets vault — keep passwords and tokens out.
- `bot-policy` turns every consequential call into a one-time approval through the existing approval UI: shell commands (`bash`/`pwsh`, foreground or background), `schedule_create`/`schedule_update`/`schedule_delete`, `bot_memory` save and delete, `spawn_teammate`, and configured browser tool prefixes. An approval never carries over: the next call asks again. Denials without a working approval channel fail closed.
- New sessions default to the `bot` preset — the standard toolset, except shell tools do not promote timed-out commands into unattended background jobs.

## Group chats and the Master Bot

- The sidebar `+` opens a menu: **New session** creates an ordinary single-agent session; **New group chat** creates a session on the `bot-group` preset, marked with a group-chat badge in the channel list.
- A group chat header carries an **Agent Team** action that opens the roster and shared task board. Inside the Lead's own conversation its **Add teammate** form names a new bot, describes its role, and optionally gives it a first instruction; ordinary single-agent sessions show no team affordance.
- The Master Bot's conversation displays as a group chat. A blank group chat opens on a group hero with the member list and the **Add teammate** form, and a line under the composer notes that messages go to the Master Bot. Once the chat starts, the header shows a group icon, and the **Agent Team** action shows member avatars and the member count. Each bot's replies appear as bubbles under its avatar and name, tool work folds into one expandable line, and messages relayed from teammates appear as bubbles from their sender. A member panel beside the transcript lists every bot with its status; selecting a teammate opens its session. The panel hides on narrow windows, and teammate sessions keep the standard conversation view.
- Inside a group chat the session agent is the Master Bot — the team Lead. Added bots become durable teammate sessions: the Master Bot addresses them by name (`send_message`), lists them, waits on them, interrupts them, and coordinates shared work on the team task board. Teammates answer in the same conversation and can address each other, so several bots collaborate inside one chat.
- Authority is enforced by the team layer, not by prompt text: only the Master Bot may create or interrupt teammates, and a teammate attempting either is refused outright. `spawn_teammate` also passes the one-time-approval policy, so each new bot is confirmed before it starts.
- Teammates join the group preset with role-conditional instructions — they keep the collaborator role and never receive the Master Bot's authority.

## Optional overlays

Apply overlays on top of `bot.patch.yml` by appending more `--patch` flags.

### Persistent browser — `browser.patch.yml`

```sh
pnpm run start:bot -- --patch apps/cli/config/examples/bot/browser.patch.yml
```

Mounts the experimental Playwright MCP provider with one persistent Chromium profile directory per session under `$DSH_HOME/bot-browser`. Cookies and site storage survive across sessions; individual tabs do not restore. Browsers launch lazily, headless, per session — opening the app starts none — and every browser call passes the same approval gate.

### SSH providers — `ssh.patch.yml`

```sh
export DSB_SSH_HOST=my-host-alias
export DSB_SSH_HELPER=/opt/dsh/helper
export DSB_SSH_HELPER_HASH=<sha256 of the helper file>
export DSB_SSH_WORKSPACE=/remote/workspace
pnpm run start:bot -- --patch apps/cli/config/examples/bot/ssh.patch.yml
```

Replaces the local filesystem, subprocess, and sandbox providers with the SSH providers, so agent commands and file operations run on the configured remote. There is no local fallback: a missing variable or bad helper hash fails the launch. POSIX client and remote only — on Windows this overlay fails at boot.

## Remote access

The Bot listens on loopback; it does not bind `0.0.0.0`. To reach it from another machine, use the existing secure channels rather than exposing the port directly:

- Forward over SSH: `ssh -L 3080:127.0.0.1:3080 user@host` keeps the listener local and transports it inside the SSH session.
- Put a TLS reverse proxy in front and keep the existing connection token authorities that the `webStartup` launch flags configure.
- Do not share the launch URL's connection token; it is the access credential and is never written to logs.

## Current limitations

- The Bot workbench appears only for a blank session; existing sessions keep their standard chrome.
- `bot_memory` is a plain literal-substring store — no embeddings, ranking, or automatic prompt injection; the model sees only memories it explicitly searched for.
- The approval policy gates the tools listed above; tools outside that set (reads, searches, todos, subagents' filtered tools) run under the normal permission preset.
- The `ssh` overlay is headless-provider substitution only; it does not add a remote UI.
