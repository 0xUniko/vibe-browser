---
name: vibe-browser
description: Connect Claude (or any local agent) to your real browser via the Vibe relay (HTTP + WS + SSE) and a Chromium extension (Tab API + CDP).
---

# Vibe Skill (Local Relay Server)

This `skill` is a **Bun-only** local relay server. It forwards messages produced/consumed by the browser extension (`extension/`) to your local tools/scripts/AI agents, and forwards your commands back to the extension so it can control the browser (Tab APIs + CDP).

The extension connects proactively:

- Health probe: `GET http://localhost:9222/health`
- Extension WebSocket: `ws://localhost:9222/extension`

So the skill must expose HTTP + WS locally (default port `9222`).

## Quick start

From the directory containing `relay.ts` (this folder):

```bash
bun relay.ts
```

You can verify it is up with a browser or curl:

- `GET http://localhost:9222/health` runs the full health check and returns JSON details.
- A healthy result is `200`; unhealthy states return `503` (including disconnected extension or blocked browser extension).

## How AI should use this (recommended workflow)

Treat this skill as a local message bus between “AI ↔ browser extension”. Typical flow:

1) Ensure the extension is loaded and connected (check `GET /health` first, then WS status if needed).
2) Have your AI/script send commands via HTTP: `POST http://localhost:9222/command`.
3) Use `tab` to fetch the active page’s `targetId`.
4) Use `cdp` to call CDP methods (e.g. `Runtime.evaluate`, `Page.navigate`, `DOM.getDocument`) with that `targetId`.

There are only two key rules:

- Most `cdp` calls require a valid `targetId` (fetch it first via `tab.getActiveTarget` or list all via `Target.getTargets`).
- `Target.getTargets` is special—it doesn't need a `targetId` and returns all browser targets.
- For the HTTP `/command` endpoint, the server assigns its own internal correlation `id` (you don’t need to provide one).

## Minimal protocol reference (condensed)

### What you send to the relay (HTTP `POST /command`)

Pick either format:

1) Direct command (recommended)

```ts
{ id: number, method: "tab" | "cdp", params: { method: string, params?: object, targetId?: string } }
```

1) Envelope (use when you want the relay to auto-assign `id`)

```ts
{ type: "command", id?: number, method: "tab" | "cdp", params: object }
```

Notes:

- Any provided `id` is ignored for HTTP requests; the relay will generate a fresh one internally.
- `{ type: "ping" }` is supported for compatibility, but it’s only useful for WebSocket-style clients.

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

type CommandBody =
    | {
            method: "tab" | "cdp";
            params: { method: string; params?: Record<string, unknown>; targetId?: string };
        }
    | {
            type: "command";
            id?: number;
            method: "tab" | "cdp";
            params: Record<string, unknown>;
        };

const call = async (body: CommandBody) => {
    const res = await fetch("http://localhost:9222/command", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
    });
    return (await res.json()) as { ok: boolean; result: any; error: string | null };
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

- Extension not responding: run `GET /health` first. If it returns `503` with `browserBlocked: true`, stop issuing commands and manually refresh the browser extension, then retry.
- Extension not responding (connection issue): if `GET /health` shows `extensionConnected: false`, confirm the extension is loaded and connected to `ws://localhost:9222/extension`.
- No responses: ensure every command includes an `id`, and you are awaiting the response with that exact `id`.
- CDP errors: most often the `targetId` is missing/incorrect—fetch it first via `tab.getActiveTarget`.
- Port in use: change `SKILL_PORT`, and ensure the extension-side connection address matches (default is `9222`).
- Request timeout (15s): if a command triggers long-running browser work, the request will be cut off and the extension can become blocked. Avoid this by splitting work into smaller commands and keeping each CDP call fast; prefer polling/steps over a single heavy operation.
- Request timeout keeps occurring: treat this as a likely blocked extension. Stop the operation, ask the user to manually refresh the extension, then analyze prior operations and split heavy actions into smaller steps.

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
