# vibe-browser

`vibe-browser` 是一个能够让用户的ai连接用户正在使用的浏览器的工具，解决现在市面上所有工具的最大痛点：ai和用户自己使用的浏览器环境是完全隔离的，导致ai没法直接使用用户保存在浏览器里面的登录信息等等问题

`vibe-browser` 放弃了同类工具中流行使用的playwright，选择了更为底层的浏览器调试工具cdp，具体技术架构如下：

- `extension/`：Chromium 扩展（WXT + TypeScript + `effect`），负责连接本地中继、并通过 Tab API + `chrome.debugger`(CDP) 执行控制与事件转发
- `skill/`：本地 Relay（HTTP + WebSocket + SSE），把“你的工具/脚本/AI”与扩展连接起来
- `scripts/`：一键安装到 OpenCode 项目（复制 `skill/` 到目标项目的 `.opencode/skills/`）

## 快速开始

## 加载浏览器扩展

### 构建扩展（在本仓库）

```bash
cd extension
bun install
bun run build
```

浏览器里打开扩展管理页，开启开发者模式后「加载已解压的扩展」，选择：`extension/.output/chrome-mv3`。

加载后点击扩展图标，在弹窗里把开关切到 `Active`，扩展会尝试连接本地 relay（默认 `http://127.0.0.1:9222`）。

### 运行relay

`bun skill\relay.ts`

连接成功之后可以在浏览器扩展里看到 `Connected to relay`

### 为你的项目注入skill

将`skill\SKILL.md`放入合适的地方让本地ai能够使用

或者使用快速设置脚本：

#### Claude Code

在你的目标项目根目录执行（会安装到 `.claude/skills/vibe-browser/`，然后可以用 `/<skill>` 调用）：

```bash
curl -fsSL https://raw.githubusercontent.com/0xUniko/vibe-browser/main/scripts/install-claude-code-skill.sh | bash
```

PowerShell（Windows）：

```powershell
irm https://raw.githubusercontent.com/0xUniko/vibe-browser/main/scripts/install-claude-code-skill.ps1 | iex

#### opencode

在你的目标项目根目录（运行 `opencode` 的目录）执行：

```bash
curl -fsSL https://raw.githubusercontent.com/0xUniko/vibe-browser/main/scripts/install-opencode-skill.sh | bash
```

## Relay 端口与接口（默认）

- 健康检查：`HEAD http://localhost:9222/healthz`
- 发送命令：`POST http://localhost:9222/command`
- 事件流（SSE）：`GET http://localhost:9222/events`
- 扩展连接（WS）：`ws://localhost:9222/extension`

可用环境变量（relay）：`SKILL_HOST`、`SKILL_PORT`、`SKILL_REQUEST_TIMEOUT_MS`。

## 项目结构

- `extension/entrypoints/background.ts`：扩展主逻辑（Effect runtime + 连接维护 + 命令路由）
- `extension/services/*`：连接、状态、Tab/CDP 路由等服务
- `skill/relay.ts`：本地 relay 实现（HTTP/WS/SSE）
- `skill/SKILL.md`：更完整的协议与使用说明（给用户/AI）
