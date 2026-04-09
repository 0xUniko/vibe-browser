# vibe-browser

## **chrome从146版本开始支持直接开启mcp连接，所以这个项目已经完成了它的历史使命**

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

### 2. 为你的项目添加skill

```bash
bunx skills add https://github.com/0xUniko/vibe-browser
```

---

### 3. 启动 relay

```bash
bun skill/scripts/relay.ts
```

默认地址：

```
http://127.0.0.1:9111
```

连接成功后扩展里会显示：

```
Connected to relay
```

---

## 技术架构

- `extension/`  
  Chromium 扩展（WXT + TypeScript + effect）  
  负责 CDP 控制、Tab 路由和事件转发

- `skill/`  
  本地 Relay 服务（对外 HTTP + SSE）  
  连接你的工具 / 脚本 / AI 与扩展

---

## Relay 接口（默认）

- 健康检查：`GET /health`
- 发送命令：`POST /command`
- 事件流（SSE）：`GET /events`

常用模式：

- `tab.getActiveTarget`：获取当前活动标签页的 `{ tabId, targetId }`
- `tab.createTab`：后台创建普通标签页，不切换当前活动标签，并返回新标签的 `{ tabId, targetId }`

环境变量：

```
SKILL_HOST
SKILL_PORT
SKILL_REQUEST_TIMEOUT_MS
SKILL_HEALTH_PROBE_TIMEOUT_MS
```

---

## 常见问题（阻塞/超时）

- 不要一次做非常“重”的操作：尽量拆成多次小操作，并且每次都等上一条命令返回后再发下一条。
- `GET /health` 只能说明“可连通/可快速探测”，并不能保证当前没有长任务在跑或扩展没有被卡住。
- 如果 `POST /command` 经常超时（默认 15s），大概率是扩展端被长任务卡住或调试链路拥塞；此时停止继续发命令，去浏览器手动刷新扩展（`chrome://extensions` 或 `edge://extensions` 里找到 `vibe-browser` 点刷新/重载），再重新切到 **Active**。

## TODO

- 优化架构和实现细节，以节省token和降低对模型智力的要求

## License

MIT
