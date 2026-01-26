# Vibe Skill (Relay Server)

This `skill` is a **Bun-only** local relay server. It forwards messages produced/consumed by the browser extension (`extension/`) to external tools (e.g. automation scripts, a debugging UI, a proxy/agent process).

The extension connects proactively:

- HTTP health probe: `HEAD http://localhost:9222/`
- WebSocket：`ws://localhost:9222/extension`

So the skill must expose HTTP + WS on local port `9222`.

## Run

From the `skill/` directory:

```bash
bun install
bun run server.ts
```

Or directly:

```bash
bun server.ts
```

## Configuration (environment variables)

- `SKILL_HOST`: bind address (default `127.0.0.1`)
- `SKILL_PORT`: port (default `9222`)
- `SKILL_REQUEST_TIMEOUT_MS`: request timeout (default `15000`)

## Endpoints

### HTTP

- `HEAD /`: used by the extension on startup to check whether the relay is available (returns `200`)
- `GET /`: returns current connection status (whether the extension is connected, number of clients)
- `GET /healthz`: simple health check
- `POST /command`: optional “HTTP→WS” bridge (internally performs a single request/response via the extension WS)

### WebSocket

- `WS /extension`: for the browser extension (only 1 connection allowed; a new connection replaces the old one)
- `WS /client`: for external tools (multiple connections allowed)

## Protocol

### ExtensionCommandMessage (server → extension)

Messages the skill sends to the extension must have the following shape (the extension will `JSON.parse` and use this shape directly):

```ts
{
 id: number,
 method: "cdp" | "tab",
 params: {
  method: string,
  params?: Record<string, unknown>,
  targetId?: string
 }
}
```

Common `tab` methods:

- `tab.countTabs`
- `tab.getActiveTargetId`
- `tab.getActiveTarget`

Common `cdp` methods:

- Any CDP method name, e.g. `Runtime.evaluate`, `Page.navigate`, etc. (must also include `params.targetId`)

### ExtensionMessage (extension → server)

The extension sends three kinds of messages back; the skill forwards them to all `/client` connections:

- Response：`{ id, result?, error? }`
- Event：`{ method: "forwardCDPEvent", params: { method, params?, targetId? } }`
- Log：`{ method: "log", params: { level, args } }`

The skill also routes responses by `id` back to the client that initiated that `id`.

### Client → server (WS /client)

A client can send messages in two ways (pick either):

1) Send a raw `ExtensionCommandMessage` (the format above).

2) Send an envelope:

```ts
{ "type": "command", "id"?: number, "method": "tab"|"cdp", "params": { ... } }
```

For a missing `id`, the skill auto-assigns an incrementing id and replies with:

- `{ type: "sent", id }`

Also supported:

- `{ type: "ping" }` → `{ type: "pong" }`

## Example: use Bun as a client

This script connects to `/client`, queries the active targetId, then performs a `Runtime.evaluate`:

```ts
// save as tmp-client.ts, run with: bun tmp-client.ts

const ws = new WebSocket("ws://localhost:9222/client");

const send = (msg: unknown) => ws.send(JSON.stringify(msg));

let nextId = 1;
const pending = new Map<number, (m: any) => void>();

ws.onmessage = (ev) => {
 const msg = JSON.parse(String(ev.data));
 if (typeof msg?.id === "number" && pending.has(msg.id)) {
  pending.get(msg.id)!(msg);
  pending.delete(msg.id);
 } else {
  console.log("event/log:", msg);
 }
};

const call = (method: "tab" | "cdp", params: any) =>
 new Promise<any>((resolve) => {
  const id = nextId++;
  pending.set(id, resolve);
  send({ id, method, params });
 });

ws.onopen = async () => {
 const active = await call("tab", { method: "tab.getActiveTarget" });
 const targetId = active?.result?.targetId;
 console.log("active targetId:", targetId);

 const evalRes = await call("cdp", {
  method: "Runtime.evaluate",
  targetId,
  params: { expression: "1 + 2" },
 });
 console.log("evaluate:", evalRes);
};
```

## Code location

- Server implementation: [skill/server.ts](skill/server.ts)
