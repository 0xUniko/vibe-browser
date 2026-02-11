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

### 3. Add the Skill into Your Project

Place `skill/SKILL.md` under `.agents/skills/<skill-name>/` in your target project so your local AI can discover and load it.

Or use the universal installer scripts below (compatible with Claude Code / opencode and other local agents).

By default, the skill is installed to `.agents/skills/vibe-browser/`.

Run in your target project root:

```bash
curl -fsSL https://raw.githubusercontent.com/0xUniko/vibe-browser/main/scripts/install-skill.sh | bash
```

PowerShell (Windows):

```powershell
irm https://raw.githubusercontent.com/0xUniko/vibe-browser/main/scripts/install-skill.ps1 | iex
```

Optional env vars: `SKILL_NAME`, `TARGET_DIR`, `REPO_URL`, `REPO_REF`.
The installer only copies the minimal runtime set: `SKILL.md`, `relay.ts`, `get-active-target.ts`, `record-network.ts`, and `references/`.

---

## Architecture

- `extension/`  
  Chromium extension (WXT + TypeScript + effect)  
  Responsible for CDP control, tab routing, and event forwarding

- `skill/`  
  Local relay service (HTTP + WebSocket + SSE)  
  Connects your tools / scripts / AI with the extension

- `scripts/`  
  One-click installation scripts for injecting the skill into local agents (shared `.agents/skills` directory)

---

## Relay APIs (Default)

- Health check: `GET /health`
- Send command: `POST /command`
- Event stream (SSE): `GET /events`
- Extension connection (WS): `ws://localhost:9222/extension`

Environment variables:

```
SKILL_HOST
SKILL_PORT
SKILL_REQUEST_TIMEOUT_MS
SKILL_HEALTH_PROBE_TIMEOUT_MS
```

---

## Troubleshooting (Blocking / Timeouts)

- Avoid a single heavy operation: split work into many small commands, and wait for each response before issuing the next one.
- `GET /health` is a reachability / quick-probe signal. It does not guarantee there is no long-running work in flight or that the extension is not partially jammed.
- If `POST /command` keeps timing out (default 15s), the extension is likely blocked/unresponsive due to heavy work or a congested debugger pipeline. Stop issuing commands and manually refresh the extension in the browser (`chrome://extensions` or `edge://extensions`, find `vibe-browser`, click reload), then switch it to **Active** again.

## TODO

- Remove ID-related details from the documentation; internal IDs should not be exposed externally.
- Optimize architecture and implementation details to save tokens and reduce cognitive load on the model.

---

## License

MIT
