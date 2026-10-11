# DeepSeek Bot

[English](deepseek-bot.md) | 中文

DeepSeek Bot 是叠加在已发布 `web` 配置文件上的可选组合：Bot 工作台首屏、持久个人记忆工具、针对重要工具调用的一次性批准策略，以及由 Master Bot 统一协调的多智能体群聊。它不新增应用二进制文件，也不新增服务器；一切都在同一个 `dsh web` 运行时、会话、工作区和导航中运行。

## 前置条件

- 本仓库的可用检出，且已完成 `pnpm install`。
- 凭证存储中已有 DeepSeek API 密钥，与任何 `dsh web` 运行相同。没有密钥时页面会显示设置状态；Bot 不需要额外配置。

## 启动

```sh
pnpm run dev:bot      # build, then serve and watch client bundles
pnpm run start:bot    # serve the already-built bundle
```

两条命令都执行 `dsh web --patch apps/cli/config/examples/bot/bot.patch.yml`，只绑定回环地址（除非启动参数另有指定，否则为 `127.0.0.1:3080`）。

## 桌面版

```sh
pnpm run dev:bot:desktop      # build, then launch the Electron development shell
pnpm run start:bot:desktop    # launch with the already-built bundles
```

两条命令都把 `bot.patch.yml` 叠加到 `desktop` 配置上——Electron 窗口中是同一个 Bot 工作台、会话和群聊。桌面开发脚本也接受可重复的 `--patch <file>` 参数来叠加其他层。

## Bot 的功能

- 空白会话视图在普通输入框上方显示 `DEEPSEEK BOT` 标题；输入框不会预填任何内容，直到你自己输入。
- `bot_memory` 让智能体在 `$DSH_HOME/storages` 下的私有存储中保存、搜索和删除记忆。共享记忆对本部署中的所有会话可见；会话级记忆仅属于其所属会话。该存储是记忆而非机密保险库——请勿存放密码或访问令牌。
- `bot_policy` 通过现有批准界面，把每一次重要调用变成一次性批准：shell 命令（`bash`/`pwsh`，前台或后台）、`schedule_create`/`schedule_update`/`schedule_delete`、`bot_memory` 的保存和删除、`spawn_teammate`，以及配置的浏览器工具前缀。批准从不沿用：下一次调用会再次询问。批准通道不可用时一律拒绝执行。
- 新会话默认使用 `bot` 预设——标准工具集，但 shell 工具不会把超时命令提升为无人值守的后台任务。

## 群聊与 Master Bot

- 侧栏 `+` 打开菜单：**新建会话**创建普通的单智能体会话；**新建群聊**在 `bot-group` 预设下创建会话，频道列表中该行会带群聊徽标。
- 群聊顶部带**智能体团队**操作，可打开成员名册和共享任务板。在 Lead 自己的会话中，**添加智能体**表单为新智能体命名、描述职责，并可附加第一条指令；普通单会话不显示团队入口。
- Master Bot 的会话以群聊界面显示。空白群聊先显示群聊首屏，其中有成员列表和**添加智能体**表单，输入框下方提示消息发给 Master Bot。开始对话后，顶部显示群聊图标，**智能体团队**操作显示成员头像和成员数。每个 Bot 的回复以气泡形式显示在其头像和名字下方，工具调用折叠为一行可展开的记录，成员转发的消息以发送者的气泡显示。对话记录旁的成员面板列出每个 Bot 及其状态；选择成员会打开其会话。窄窗口中面板隐藏，成员会话保留标准会话视图。
- 群聊中的会话智能体即 Master Bot——团队的 Lead。添加的智能体成为持久的成员会话：Master Bot 按名字发送消息（`send_message`）、列出成员、等待或中断成员，并通过团队任务板协调共享工作。成员在同一会话中回复，也可以互相通信，因此多个智能体在同一个群聊里协同。
- 权限由团队层强制执行，不依赖提示词：只有 Master Bot 可以创建或中断成员；成员尝试任一操作都会被直接拒绝。`spawn_teammate` 同样经过一次性批准，每个新智能体启动前都需要确认。
- 成员加入群聊预设时获得按角色区分的指令——它们保留协作者角色，不会获得 Master Bot 的权限。

## 可选叠加层

在 `bot.patch.yml` 之后追加更多 `--patch` 参数来叠加。

### 持久浏览器 —— `browser.patch.yml`

```sh
pnpm run start:bot -- --patch apps/cli/config/examples/bot/browser.patch.yml
```

挂载实验性 Playwright MCP 提供方，在 `$DSH_HOME/bot-browser` 下为每个会话维护一个持久的 Chromium 配置目录。Cookie 和站点存储跨会话保留；具体标签页不会恢复。浏览器按会话惰性启动且默认无头——打开应用不会启动浏览器——每次浏览器调用同样经过批准关卡。

### SSH 提供方 —— `ssh.patch.yml`

```sh
export DSB_SSH_HOST=my-host-alias
export DSB_SSH_HELPER=/opt/dsh/helper
export DSB_SSH_HELPER_HASH=<sha256 of the helper file>
export DSB_SSH_WORKSPACE=/remote/workspace
pnpm run start:bot -- --patch apps/cli/config/examples/bot/ssh.patch.yml
```

将本地文件系统、子进程和沙箱提供方替换为 SSH 提供方，使代理命令和文件操作在配置的远端上运行。没有本地回退：变量缺失或 helper 哈希不匹配都会导致启动失败。仅支持 POSIX 客户端和远端——在 Windows 上该叠加层会在启动时报错。

## 远程访问

Bot 只监听回环地址，不会绑定 `0.0.0.0`。要从其他机器访问，请使用现有安全通道，而不是直接暴露端口：

- 通过 SSH 转发：`ssh -L 3080:127.0.0.1:3080 user@host` 保持监听本地，流量在 SSH 会话内传输。
- 在前面放 TLS 反向代理，并保留 `webStartup` 启动参数配置的既有连接令牌鉴权。
- 不要分享启动 URL 中的连接令牌；它是访问凭证，永远不会写入日志。

## 当前限制

- Bot 工作台只在空白会话出现；已有会话保留标准外观。
- `bot_memory` 是纯字面子串存储——没有嵌入、排序或自动提示词注入；模型只能看到它显式搜索过的记忆。
- 批准策略只覆盖上述工具；范围外的工具（读取、搜索、待办、子代理已过滤的工具）仍按常规权限预设运行。
- `ssh` 叠加层只做无头提供方替换；不增加远程 UI。
