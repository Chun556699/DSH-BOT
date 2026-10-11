---
description: "持久个人记忆存储及 bot_memory 工具（保存/搜索/删除），基于 storage-domain 层，作用域为共享或会话私有。"
kind: "package-reference"
---

# @deepseek-ai/dsh-bot-memory

[English](README.md) | 中文

## 概述

使用 `dsh-bot-memory` 通过 `bot_memory` 工具为代理提供持久个人记忆存储。记录保存在 `bot_memory` 存储域中——DSH 主目录下一个部署私有的存储，每条记录一个 JSON 文档——并跨重启保留。`shared` 记录对本部署内所有会话可见；`session` 记录仅属于其所属会话，永远不会泄露到其他会话的搜索或删除中。没有任何内容被注入提示词：模型只能看到它显式搜索过的记忆，且该存储不是机密保险库。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与暂缓工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

将本行加入需要让代理跨对话保留记忆的组合中；当部署需要一次性批准时，由 `packages/interaction/bot-policy` 对其保存和删除操作进行把关。

### 何时选择它

适合希望代理跨会话保留有用上下文的个人部署。它是单操作者私有存储，不是团队共享知识库。

### 唯一的工具

- `bot_memory(action, <content|query|id>, <scope|limit>)` —— `save` 将 `content`（非空，至多 2048 UTF-8 字节）存为 `shared`（默认）或 `session` 私有。`search` 做大小写不敏感的字面子串匹配，按 `updatedAt` 从新到旧，最多返回 10 条（`limit` 1–10，默认 5）；省略 `query` 则列出最近的可访问记忆。`delete` 删除一条可访问记录；不存在或不可访问的 id 统一返回 `deleted: false`。

### 最小配置

```yaml
- name: '@deepseek-ai/dsh-bot-memory'
```

`maxRecords`（默认 1000，范围 1–10000）是准入上限：存储已满时新的保存以 `capacity_reached` 拒绝，且永不驱逐现有记录。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

插件通过 `ctx.storageDomain` 打开 `bot_memory` 域（版本 1，per-record 布局），持久性由挂载的后端负责——已发布的组合中是 `storage-json`。每个操作都要求在 `ctx.agents` 中校验过的活体调用 Agent；会话作用域从 `agent.session.id` 推导 `ownerSession`，从不取自参数。变更准入经过串行化，并发保存无法竞争容量上限，每个排队写入在其槽位内重新检查取消。处置时先排空已准入的写入再关闭域。非法的 action/参数组合返回 `invalid_arguments`；后端写入失败返回 `internal_error`，不会伪报成功。

### 源码索引

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`bot_memory` 注册、准入串行化、作用域强制、render/present 辅助 |
| [`src/spec.ts`](src/spec.ts) | 域规范与持久记录模式（作用域/所有者一致性、字节上限） |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

- [Storage domain 服务](../storage-domain/README.zh.md) —— 本包打开的域/表设施。
- [Bot policy](../../interaction/bot-policy/README.zh.md) —— 将记忆写入变成一次性询问的批准关卡。

-----

<a id="model-experience"></a>
## 模型体验

### 工具模式

#### 模型看到什么

挂载本包时生成的 [`bot_memory` 模式](../../../docs/tool-catalog.zh.md#deepseek-aidsh-bot-memory)：一个 `action` 枚举加上 `content`、`query`、`id`、`scope`、`limit`，描述中说明共享与会话可见性以及禁止存放机密的规则。

#### 令牌开销

挂载期间每次请求的固定模式开销。

#### KV Cache 影响

工具定义不变时前缀保持稳定。

### 记忆结果

#### 模型看到什么

每次调用一个 JSON 文本块：save/search 返回 `{action, memories[]}`，delete 返回 `{action, memories: [], deleted}`，或带稳定错误码的 `{code, message}`。

#### 令牌开销

搜索结果留在调用会话历史中直至压缩；`limit` 大小的一页会在后续请求中重复。

#### KV Cache 影响

仅追加；新返回的内容不会使前缀失效。

## 已知限制与暂缓工作

<a id="known-limitations-and-deferred-work"></a>

- **仅字面搜索** —— 匹配为大小写不敏感的子串；没有嵌入、排序或模糊召回。
- **无自动注入** —— 记忆不会未经请求进入提示词；代理必须自己调用 `search`。
- **存储满即拒绝写入** —— `capacity_reached` 是唯一信号；没有驱逐、截断或压缩过程。
- **要求活体调用 Agent** —— 宿主侧或无 Agent 的调用者收到 `agent_required`。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>
