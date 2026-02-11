# vibe-browser

[English](./README-en.md)

---

## 项目简介

`vibe-browser` 让 AI **直接连接你正在使用的真实浏览器实例**。

它不会启动新的自动化浏览器，而是附加到当前浏览器进程，共享同一套运行时和会话状态。

因此 AI 可以直接：

- 复用登录状态
- 访问 Cookie
- 读取 Local Storage
- 操作真实标签页

无需重新登录，也无需同步环境。

**这是 `vibe-browser` 与市面同类浏览器自动化工具最大的区别。**

项目不使用playwright，而是直接基于 Chrome DevTools Protocol（CDP）实现，提供更底层、更轻量的控制能力。

---

## 快速开始

### 1. 构建扩展

```bash
cd extension
bun install
bun run build
```

浏览器加载：

```
extension/.output/chrome-mv3
```

开启扩展并切换为 **Active**。

---

### 2. 启动 relay

```bash
bun skill/relay.ts
```

默认地址：

```
http://127.0.0.1:9222
```

连接成功后扩展里会显示：

```
Connected to relay
```

---

### 3. 为你的项目添加skill

将 `skill/SKILL.md` 放入目标项目的 `.agents/skills/<skill-name>/` 下，让本地 AI 能发现并加载。

或者使用通用安装脚本（兼容 Claude Code / opencode 等本地 agent）：

默认会安装到 `.agents/skills/vibe-browser/`。

在你的目标项目根目录执行：

```bash
curl -fsSL https://raw.githubusercontent.com/0xUniko/vibe-browser/main/scripts/install-skill.sh | bash
```

PowerShell（Windows）：

```powershell
irm https://raw.githubusercontent.com/0xUniko/vibe-browser/main/scripts/install-skill.ps1 | iex
```

可选环境变量：`SKILL_NAME`、`TARGET_DIR`、`REPO_URL`、`REPO_REF`。
安装脚本只会复制最小运行集合：`SKILL.md`、`relay.ts`、`get-active-target.ts`、`record-network.ts`、`references/`。

---

## 技术架构

- `extension/`  
  Chromium 扩展（WXT + TypeScript + effect）  
  负责 CDP 控制、Tab 路由和事件转发

- `skill/`  
  本地 Relay 服务（HTTP + WebSocket + SSE）  
  连接你的工具 / 脚本 / AI 与扩展

- `scripts/`  
  一键安装脚本，用于向本地 agent 注入 skill（统一目录 `.agents/skills`）

---

## Relay 接口（默认）

- 健康检查：`GET /health`
- 发送命令：`POST /command`
- 事件流（SSE）：`GET /events`
- 扩展连接（WS）：`ws://localhost:9222/extension`

环境变量：

```
SKILL_HOST
SKILL_PORT
SKILL_REQUEST_TIMEOUT_MS
SKILL_HEALTH_PROBE_TIMEOUT_MS
```

---

## TODO

- 清理文档里面关于id的内容，内部id不要对外暴露
- 优化架构和实现细节，以节省token和降低对模型智力的要求

## License

MIT
