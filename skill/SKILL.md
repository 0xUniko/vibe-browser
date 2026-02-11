---
name: vibe-browser
description: Connect Claude (or any local agent) to your real browser via the Vibe relay and a Chromium extension (Tab API + CDP).
---

# Vibe Skill (Local Relay Server)

This `skill` is a **Bun-only** local relay server. It forwards messages between the browser extension (`extension/`) and your local tools/scripts/AI agents so the browser can be controlled through Tab APIs + CDP.

For users/AI, treat this as an HTTP service (default port `9222`). Extension-side connection details are internal implementation details.

## Quick start

From the directory containing `relay.ts` (this folder):

```bash
bun relay.ts
```

You can verify it is up with a browser or curl:

- `GET http://localhost:9222/health` runs the full health check and returns JSON details.
- A healthy result is `200`; unhealthy states return `503` (e.g. disconnected extension, or the extension failing a quick probe).
- Note: `/health` is a best-effort reachability check. With concurrent command handling in the extension, a `200` does not guarantee there is no ongoing long-running browser work.

## How AI should use this (recommended workflow)

Treat this skill as a local message bus between "AI ↔ browser extension". Typical flow:

1. Ensure the extension is loaded and connected (check `GET /health` first).
2. Have your AI/script send commands via HTTP: `POST http://localhost:9222/command`.
3. Use `tab` to fetch the active page’s `targetId`.
4. Use `cdp` to call CDP methods (e.g. `Runtime.evaluate`, `Page.navigate`, `DOM.getDocument`) with that `targetId`.

There are only two key rules:

- Most `cdp` calls require a valid `targetId` (fetch it first via `tab.getActiveTarget` or list all via `Target.getTargets`).
- `Target.getTargets` is special—it doesn't need a `targetId` and returns all browser targets.
- Avoid issuing a single heavy/long-running operation. Prefer many small calls and wait for each response before sending the next one.

## Minimal protocol reference (condensed)

### What you send to the relay (HTTP `POST /command`)

Use this command shape:

```ts
{ method: "tab" | "cdp", params: { method: string, params?: object, targetId?: string } }
```

### What you receive

- HTTP response (from `POST /command`): `{ ok: boolean, result: any | null, error: string | null }`
- SSE stream (from `GET /events`): JSON messages such as:
  - `{ type: "status", extensionConnected: boolean }`
  - `{ method: "forwardCDPEvent", params: { method, params?, targetId? } }`
  - `{ method: "log", params: { level, args } }`

## Example: get targetId, then evaluate

Short Bun client example (you can ask AI to generate more complex scripts following this pattern):

```ts
// tmp-client.ts (run: bun tmp-client.ts)

type CommandBody = {
  method: "tab" | "cdp";
  params: {
    method: string;
    params?: Record<string, unknown>;
    targetId?: string;
  };
};

const call = async (body: CommandBody) => {
  const res = await fetch("http://localhost:9222/command", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json()) as {
    ok: boolean;
    result: any;
    error: string | null;
  };
};

// Example 1: List all browser targets (no targetId needed)
const targets = await call({
  method: "cdp",
  params: { method: "Target.getTargets" },
});
console.log("all targets:", targets.result?.targetInfos?.length);

// Example 2: Get active tab's target
const active = await call({
  method: "tab",
  params: { method: "tab.getActiveTarget" },
});
const targetId = active?.result?.targetId;
console.log("active targetId:", targetId);

// Example 3: Evaluate JS in the active tab (requires targetId)
const evaluated = await call({
  method: "cdp",
  params: {
    method: "Runtime.evaluate",
    targetId,
    params: { expression: "1 + 2" },
  },
});
console.log("evaluate:", evaluated);
```

## Troubleshooting (for users/AI)

- Extension not responding: run `GET /health` first. If it returns `503`, stop issuing commands and manually refresh the browser extension, then retry.
- Extension not responding (connection issue): if `GET /health` shows `extensionConnected: false`, open the extension popup and switch it to **Active**.
- No responses (HTTP): confirm request JSON is valid and keep each command small.
- CDP errors: most often the `targetId` is missing/incorrect—fetch it first via `tab.getActiveTarget`.
- Port in use: change `SKILL_PORT`, and ensure the extension-side connection address matches (default is `9222`).
- Request timeout (default 15s): the relay returns a timeout when the extension does not respond within `SKILL_REQUEST_TIMEOUT_MS`. This is usually caused by a command that triggered long-running browser work (a "heavy" operation). Avoid this by splitting work into smaller commands and keeping each CDP call fast; prefer polling/steps over a single heavy operation.
- Why this happens (important): the extension now processes commands concurrently, so `GET /health` (or `tab.getActiveTarget`) is no longer a reliable "blocked or not" signal. A quick probe can succeed even while another long-running command is still executing or a specific target is jammed.
- After a timeout: the original command may still complete in the extension and arrive late as an `orphan-response` on `GET /events`. This is a strong sign the operation was too heavy and should be decomposed.
- Timeouts keep occurring: treat this as a likely blocked/unresponsive extension (service worker stuck, debugger pipeline jammed, or browser work saturated). Stop issuing commands and manually refresh the extension.
- Manual refresh (Chrome): open `chrome://extensions`, find `vibe-browser`, click the reload icon (or toggle it off and on), then open the extension popup and switch it to **Active** again.
- Manual refresh (Edge): open `edge://extensions` and do the same.

## Configuration (environment variables)

- `SKILL_HOST`: bind address (default `127.0.0.1`)
- `SKILL_PORT`: port (default `9222`)
- `SKILL_REQUEST_TIMEOUT_MS`: request timeout (default `15000`)
- `SKILL_HEALTH_PROBE_TIMEOUT_MS`: timeout for `GET /health` active-target probe (default `min(3000, SKILL_REQUEST_TIMEOUT_MS)`)

## Code location

- Implementation: [relay.ts](relay.ts)

## Utility scripts

These scripts are generic relay/CDP helpers and are not GMGN-specific:

- Active tab target lookup:
  - `bun .agents/skills/vibe-browser/get-active-target.ts`
- Unified network recorder (HTTP + WebSocket):
  - `bun .agents/skills/vibe-browser/record-network.ts <targetId> [outFile] [autoStopMs]`

Recorder quick examples:

```bash
# record both HTTP + WS (default)
bun .agents/skills/vibe-browser/record-network.ts <targetId>

# record HTTP only
INCLUDE_WS=0 HTTP_ONLY=1 bun .agents/skills/vibe-browser/record-network.ts <targetId>

# record WS only
INCLUDE_HTTP=0 bun .agents/skills/vibe-browser/record-network.ts <targetId> ws.jsonl 20000
```

Detailed options: [references/network-recorder.md](references/network-recorder.md)
