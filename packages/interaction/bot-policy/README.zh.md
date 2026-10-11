---
description: "Bot 组合的执行前策略：把重要工具调用（shell、计划任务、记忆写入、浏览器）变成一次性用户批准。"
kind: "package-reference"
---

# @deepseek-ai/dsh-bot-policy

[English](README.md) | 中文

## 概述

使用 `dsh-bot-policy` 把 DeepSeek Bot 的重要操作置于现有用户批准通道之后。它注册一个前置的 `tools/pre-execute` 监听器：先咨询所有后续监听器，原样保留上游的拒绝、取消和询问，只在干净的 `allow` 上追加一次性 `ask`——覆盖每一次 `bash`/`pwsh` 调用、每一次 `schedule_create`/`schedule_update`/`schedule_delete`、每一次 `bot_memory` 保存或删除，以及匹配配置的浏览器前缀的所有工具名。每个受限调用各自询问一次批准；批准绝不复用。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

在需要把现有批准服务与更强逐次同意结合的组合中插入一行：

```yaml
- name: '@deepseek-ai/dsh-bot-policy'
```

`browserToolPrefixes`（默认 `['mcp__playwright-mcp__', 'mcp__chrome-devtools-mcp__']`，必须非空）声明被视为浏览器操作的工具前缀。

### 何时选择它

适合希望代理自由读取和规划、但持久或重要操作每次都需要人工确认点击的部署。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

监听器以 `{ prepend: true }` 注册，先等待 `next()` 再决定：下游的 `deny`、`cancel`、`ask` 原样返回，因此策略只会加强、绝不削弱其他防护。下游的 `allow` 变成 `{ kind: 'ask', reason, displayReason }`，其展示理由带中英文直接文本供批准界面使用。ToolRuntime 把每个 ask 通过批准服务路由且仅限该次调用：`allowed-once` 放行一次，`rejected`/`cancelled`/`unavailable` 一律拒绝，缺少批准服务则直接拒绝。受限集之外的调用——读取、`bot_memory` 搜索，以及未列出的工具——原样放行。处置插件会移除监听器，之后调用不再受限。

### 源码索引

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：前置关卡、受限名称匹配、批准文案 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [工具运行时](../../core/tools/README.zh.md) —— 本监听器加入的 `tools/pre-execute` 瀑布。
- [用户批准](../user-approval/README.zh.md) —— 应答每个 `ask` 的服务。
- [Bot 记忆](../../storage/bot-memory/README.zh.md) —— 本关卡覆盖写入的存储。

-----

<a id="model-experience"></a>
## 模型体验

无，本包不注册工具，只改变执行前决策。

#### KV Cache 影响

批准策略不向模型请求贡献内容。

## 已知限制与暂缓工作

<a id="known-limitations-and-deferred-work"></a>

- **按名称覆盖** —— 关卡匹配工具名和配置的前缀；以其他名称注册的 shell 命令表面需要在 `browserToolPrefixes` 中自行加入，否则该部署的 shell 名称集合不完整。
- **仅一次性** —— 关卡刻意不提供"始终允许"；需要可复用授权的部署应改用现有批准服务自身的策略。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
