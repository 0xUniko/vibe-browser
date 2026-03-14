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

### 2. Add the Skill into Your Project

```bash
bunx skills add https://github.com/0xUniko/vibe-browser
```

---

### 3. Start the Relay

```bash
bun skill/scripts/relay.ts
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

## Architecture

- `extension/`  
  Chromium extension (WXT + TypeScript + effect)  
  Responsible for CDP control, tab routing, and event forwarding

- `skill/`  
  Local relay service (public HTTP + SSE)  
  Connects your tools / scripts / AI with the extension

---

## Relay APIs (Default)

- Health check: `GET /health`
- Send command: `POST /command`
- Event stream (SSE): `GET /events`

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

- Optimize architecture and implementation details to save tokens and reduce cognitive load on the model.

---

## License

MIT
