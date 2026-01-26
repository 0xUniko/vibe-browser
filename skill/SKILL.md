# Vibe Skill (Local Relay Server)

This `skill` is a **Bun-only** local relay server. It forwards messages produced/consumed by the browser extension (`extension/`) to your local tools/scripts/AI agents, and forwards your commands back to the extension so it can control the browser (Tab APIs + CDP).

The extension connects proactively:

- Health probe: `HEAD http://localhost:9222/healthz`
- Extension WebSocket: `ws://localhost:9222/extension`

So the skill must expose HTTP + WS locally (default port `9222`).

## Quick start

From the `skill/` directory:

```bash
bun install
bun run relay.ts
```

Or directly:

```bash
bun relay.ts
```

You can verify it is up with a browser or curl:

- `GET http://localhost:9222/healthz` → `200`

## How AI should use this (recommended workflow)

Treat this skill as a local message bus between “AI ↔ browser extension”. Typical flow:

1) Start the relay (this skill).
2) Ensure the extension is loaded and connected (the relay console will log connections; you can also check `/healthz` and WS status).
3) Have your AI/script connect as a client: `ws://localhost:9222/client`.
4) Use `tab` to fetch the active page’s `targetId`.
5) Use `cdp` to call CDP methods (e.g. `Runtime.evaluate`, `Page.navigate`, `DOM.getDocument`) with that `targetId`.

There are only two key rules:

- Every request must include a numeric `id`; the response will carry the same `id`.
- Most `cdp` calls require a valid `targetId` (fetch it first).

## Minimal protocol reference (condensed)

### What you send to the relay (WS `/client`)

Pick either format:

1) Direct command (recommended)

```ts
{ id: number, method: "tab" | "cdp", params: { method: string, params?: object, targetId?: string } }
```

1) Envelope (use when you want the relay to auto-assign `id`)

```ts
{ type: "command", id?: number, method: "tab" | "cdp", params: object }
```

Also supported: `{ type: "ping" }` → `{ type: "pong" }`.

### What you receive

- Response: `{ id, result?, error? }`
- Forwarded CDP event: `{ method: "forwardCDPEvent", params: { method, params?, targetId? } }`
- Log: `{ method: "log", params: { level, args } }`

## Example: get targetId, then evaluate

Short Bun client example (you can ask AI to generate more complex scripts following this pattern):

```ts
// tmp-client.ts (run: bun tmp-client.ts)

const ws = new WebSocket("ws://localhost:9222/client");

let nextId = 1;
const pending = new Map<number, (msg: any) => void>();

ws.onmessage = (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (typeof msg?.id === "number" && pending.has(msg.id)) {
        pending.get(msg.id)!(msg);
        pending.delete(msg.id);
        return;
    }
    console.log("event/log:", msg);
};

const call = (method: "tab" | "cdp", params: any) =>
    new Promise<any>((resolve) => {
        const id = nextId++;
        pending.set(id, resolve);
        ws.send(JSON.stringify({ id, method, params }));
    });

ws.onopen = async () => {
    const active = await call("tab", { method: "tab.getActiveTarget" });
    const targetId = active?.result?.targetId;
    console.log("active targetId:", targetId);

    const res = await call("cdp", {
        method: "Runtime.evaluate",
        targetId,
        params: { expression: "1 + 2" },
    });
    console.log("evaluate:", res);
};
```

## Troubleshooting (for users/AI)

- Extension not responding: confirm the relay is up (`/healthz` returns `200`), then confirm the extension is connected to `ws://localhost:9222/extension`.
- No responses: ensure every command includes an `id`, and you are awaiting the response with that exact `id`.
- CDP errors: most often the `targetId` is missing/incorrect—fetch it first via `tab.getActiveTarget`.
- Port in use: change `SKILL_PORT`, and ensure the extension-side connection address matches (default is `9222`).

## Configuration (environment variables)

- `SKILL_HOST`: bind address (default `127.0.0.1`)
- `SKILL_PORT`: port (default `9222`)
- `SKILL_REQUEST_TIMEOUT_MS`: request timeout (default `15000`)

## Code location

- Implementation: [skill/relay.ts](skill/relay.ts)
