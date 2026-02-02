# vibe-browser

[中文](./README.md)

---

## Project Overview

`vibe-browser` allows AI to **directly connect to the real browser instance you are currently using**.

It does not launch a new automated browser. Instead, it attaches to the existing browser process and shares the same runtime and session state.

This means the AI can directly:

- Reuse login sessions
- Access cookies
- Read Local Storage
- Operate real tabs

No re-login and no environment synchronization are required.

**This is the biggest difference between `vibe-browser` and typical browser automation tools.**

The project does not use Playwright. It is implemented directly on top of the Chrome DevTools Protocol (CDP), providing lower-level and more lightweight control.

---

## Architecture

- `extension/`  
  Chromium extension (WXT + TypeScript + effect)  
  Responsible for CDP control, tab routing, and event forwarding

- `skill/`  
  Local relay service (HTTP + WebSocket + SSE)  
  Connects your tools / scripts / AI with the extension

- `scripts/`  
  One-click installation scripts for injecting the skill into OpenCode / Claude Code

---

## Quick Start

### 1. Build the Extension

```bash
cd extension
bun install
bun run build
```

Load in browser:

```
extension/.output/chrome-mv3
```

Enable the extension and switch it to **Active**.

---

### 2. Start the Relay

```bash
bun skill/relay.ts
```

Default address:

```
http://127.0.0.1:9222
```

After a successful connection, the extension will show:

```
Connected to relay
```

---

## Add the Skill into Your Project

Place `skill/SKILL.md` in the appropriate location so your local AI can use it.

Or use the quick setup scripts below:

### Claude Code

Run in your target project root (installs to `.claude/skills/vibe-browser/`, then invoke with `/<skill>`):

```bash
curl -fsSL https://raw.githubusercontent.com/0xUniko/vibe-browser/main/scripts/install-claude-code-skill.sh | bash
```

PowerShell (Windows):

```powershell
irm https://raw.githubusercontent.com/0xUniko/vibe-browser/main/scripts/install-claude-code-skill.ps1 | iex
```

### opencode

Run in your target project root (where you execute `opencode`):

```bash
curl -fsSL https://raw.githubusercontent.com/0xUniko/vibe-browser/main/scripts/install-opencode-skill.sh | bash
```

---

## Relay APIs (Default)

- Health check: `HEAD /healthz`
- Send command: `POST /command`
- Event stream (SSE): `GET /events`
- Extension connection (WS): `ws://localhost:9222/extension`

Environment variables:

```
SKILL_HOST
SKILL_PORT
SKILL_REQUEST_TIMEOUT_MS
```

---

## TODO

- Improve the health check mechanism; also detect whether the browser is blocked. If blocked, prompt the user to manually refresh the extension.
- Remove ID-related details from the documentation; internal IDs should not be exposed externally.
- Optimize architecture and implementation details to save tokens and reduce cognitive load on the model.

---

## License

MIT
