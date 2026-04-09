---
name: vibe-browser
description: Connect a local AI agent to the user's real Chromium browser through the vibe-browser relay and extension. Use when the agent needs to inspect pages, drive tabs, call Chrome DevTools Protocol methods, or capture browser network traffic from an already-running user browser session.
---

# Vibe Browser

Treat this skill as an HTTP bridge to a relay that the user runs manually. Never start the relay yourself. Always verify `GET http://127.0.0.1:9111/health` first and only continue when it is healthy.

## Follow this workflow

1. Check `GET /health`.
2. If the request fails, or returns a non-`200` status, stop and tell the user to manually start or recover the relay.
3. Only after health is good, use `POST /command` and `GET /events`.
4. Keep browser work incremental. Prefer many small CDP calls over one heavy operation.

## Tell the user this when relay is unavailable

Use direct wording. Do not attempt to launch the process yourself.

```text
Relay is not ready. Please start or recover it manually, then tell me to continue.
Expected command: bun .agents/skills/vibe-browser/scripts/relay.ts
Then confirm http://127.0.0.1:9111/health returns 200.
```

If `/health` says the extension is disconnected, instruct the user to open the extension popup and switch it to `Active`. If `/health` says the browser is blocked, instruct the user to refresh the extension manually in `chrome://extensions` or `edge://extensions`.

## Command protocol

Send commands to `POST /command` with this shape:

```ts
{
  method: "tab" | "cdp",
  params: {
    method: string;
    params?: Record<string, unknown>;
    targetId?: string;
  };
}
```

Use `tab.getActiveTarget` before most `cdp` calls. `Target.getTargets` is the main exception and does not require `targetId`.

For background work, `tab.createTab` can create a normal background tab without switching the user's active tab. It returns `{ tabId, targetId }`, so you can continue with `cdp` commands immediately.

## Use bundled scripts

- Active tab lookup: `bun .agents/skills/vibe-browser/scripts/get-active-target.ts`
- Network recorder: `bun .agents/skills/vibe-browser/scripts/record-network.ts <targetId> [outFile] [autoStopMs]`
- Relay entrypoint for the user: `bun .agents/skills/vibe-browser/scripts/relay.ts`

Read [references/network-recorder.md](references/network-recorder.md) only when you need recorder options.
