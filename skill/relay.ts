type JsonPrimitive = string | number | boolean | null;
type Json = JsonPrimitive | Json[] | { [key: string]: Json };

import type { ServerWebSocket } from "bun";

type ExtensionMethod = "cdp" | "tab";

export interface ExtensionCommandMessage {
  /** Correlation id for a single HTTP request bridged through WS. */
  id: number;
  method: ExtensionMethod;
  params: {
    method: string;
    params?: Record<string, unknown>;
    targetId?: string;
  };
}

export interface ExtensionResponseMessage {
  id: number;
  result?: unknown;
  error?: string;
}

export interface ExtensionEventMessage {
  method: "forwardCDPEvent";
  params: {
    method: string;
    params?: Record<string, unknown>;
    targetId?: string;
  };
}

export interface ExtensionLogMessage {
  method: "log";
  params: {
    level: string;
    args: string[];
  };
}

export type ExtensionMessage =
  | ExtensionResponseMessage
  | ExtensionEventMessage
  | ExtensionLogMessage;

type ClientEnvelope =
  | {
      type: "command";
      id?: number;
      method: ExtensionMethod;
      params: ExtensionCommandMessage["params"];
    }
  | { type: "ping" };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

const safeJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};

const json = (value: Json, init?: ResponseInit) =>
  new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init?.headers ?? {}),
    },
    ...init,
  });

const isExtensionMethod = (v: unknown): v is ExtensionMethod =>
  v === "cdp" || v === "tab";

const isExtensionCommandMessage = (
  v: unknown,
): v is ExtensionCommandMessage => {
  if (!isRecord(v)) return false;
  if (typeof v.id !== "number") return false;
  if (!isExtensionMethod(v.method)) return false;
  if (!isRecord(v.params)) return false;
  if (typeof v.params.method !== "string") return false;
  if (v.params.params !== undefined && !isRecord(v.params.params)) return false;
  if (
    v.params.targetId !== undefined &&
    typeof v.params.targetId !== "string"
  ) {
    return false;
  }
  return true;
};

const isExtensionResponseMessage = (
  v: unknown,
): v is ExtensionResponseMessage => {
  if (!isRecord(v)) return false;
  if (typeof v.id !== "number") return false;
  if (v.error !== undefined && typeof v.error !== "string") return false;
  return true;
};

const isExtensionEventMessage = (v: unknown): v is ExtensionEventMessage => {
  if (!isRecord(v)) return false;
  if (v.method !== "forwardCDPEvent") return false;
  if (!isRecord(v.params)) return false;
  if (typeof v.params.method !== "string") return false;
  if (v.params.params !== undefined && !isRecord(v.params.params)) return false;
  if (
    v.params.targetId !== undefined &&
    typeof v.params.targetId !== "string"
  ) {
    return false;
  }
  return true;
};

const isExtensionLogMessage = (v: unknown): v is ExtensionLogMessage => {
  if (!isRecord(v)) return false;
  if (v.method !== "log") return false;
  if (!isRecord(v.params)) return false;
  if (typeof v.params.level !== "string") return false;
  if (!Array.isArray(v.params.args)) return false;
  if (!v.params.args.every((a) => typeof a === "string")) return false;
  return true;
};

const isClientEnvelope = (v: unknown): v is ClientEnvelope => {
  if (!isRecord(v)) return false;
  if (v.type === "ping") return true;
  if (v.type !== "command") return false;
  if (v.id !== undefined && typeof v.id !== "number") return false;
  if (!isExtensionMethod(v.method)) return false;
  if (!isRecord(v.params)) return false;
  if (typeof v.params.method !== "string") return false;
  return true;
};

type WsRole = "extension" | "client";
type WsData = { role: WsRole };
type SkillWs = ServerWebSocket<WsData>;

const HOST = process.env.SKILL_HOST ?? "127.0.0.1";
const PORT = Number(process.env.SKILL_PORT ?? "9222");
const REQUEST_TIMEOUT_MS = Number(
  process.env.SKILL_REQUEST_TIMEOUT_MS ?? "15000",
);

const EXTENSION_KEEPALIVE_MS = Number(
  process.env.SKILL_EXTENSION_KEEPALIVE_MS ?? "20000",
);

const SSE_KEEPALIVE_MS = Number(process.env.SKILL_SSE_KEEPALIVE_MS ?? "15000");

const state = {
  extension: null as SkillWs | null,
  nextId: 1,
  pending: new Map<
    number,
    {
      resolve: (msg: ExtensionResponseMessage) => void;
      timeoutId: ReturnType<typeof setTimeout>;
    }
  >(),
  extensionKeepaliveId: null as ReturnType<typeof setInterval> | null,
  sseClients: new Set<ReadableStreamDefaultController<Uint8Array>>(),
};

const wsSendJson = (ws: SkillWs, message: unknown): void => {
  if (ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // ignore
  }
};

const textEncoder = new TextEncoder();

const sseBroadcast = (message: unknown): void => {
  const payload = `data: ${JSON.stringify(message)}\n\n`;
  const bytes = textEncoder.encode(payload);
  for (const controller of state.sseClients) {
    try {
      controller.enqueue(bytes);
    } catch {
      // ignore
    }
  }
};

const respondPending = (pendingId: number, msg: ExtensionResponseMessage) => {
  const pending = state.pending.get(pendingId);
  if (!pending) return;

  clearTimeout(pending.timeoutId);
  state.pending.delete(pendingId);

  pending.resolve(msg);
};

const log = (level: "info" | "warn" | "error", ...args: unknown[]): void => {
  const prefix = `[skill][${level}]`;
  // eslint-disable-next-line no-console
  (level === "error"
    ? console.error
    : level === "warn"
      ? console.warn
      : console.log)(prefix, ...args);
};

const makeCommand = (
  partial: Omit<ExtensionCommandMessage, "id"> & { id?: number },
): ExtensionCommandMessage => {
  // Always generate a fresh id for each HTTP request to avoid collisions.
  const id = state.nextId++;
  return { ...partial, id };
};

const stopExtensionKeepalive = (): void => {
  if (!state.extensionKeepaliveId) return;
  clearInterval(state.extensionKeepaliveId);
  state.extensionKeepaliveId = null;
};

const startExtensionKeepalive = (ws: SkillWs): void => {
  stopExtensionKeepalive();
  state.extensionKeepaliveId = setInterval(() => {
    if (ws.readyState !== WebSocket.OPEN) return;

    const maybePing = (
      candidate: unknown,
    ): candidate is { ping: (data?: string | Uint8Array) => void } =>
      isRecord(candidate) && typeof candidate.ping === "function";

    try {
      if (maybePing(ws)) {
        ws.ping();
      } else {
        // Fallback app-level ping (extension may ignore safely)
        wsSendJson(ws, { type: "ping" });
      }
    } catch {
      // ignore
    }
  }, EXTENSION_KEEPALIVE_MS);
};

const parseHttpCommandBody = (
  body: unknown,
): ExtensionCommandMessage | null => {
  if (!isRecord(body)) return null;

  if (isExtensionCommandMessage(body)) {
    return makeCommand({
      method: body.method,
      params: body.params,
    });
  }

  if (isClientEnvelope(body)) {
    if (body.type !== "command") return null;
    return makeCommand({
      method: body.method,
      params: body.params,
    });
  }

  const method = body.method;
  const params = body.params;
  // NOTE: any incoming id from HTTP is ignored; server generates id for correlation.

  if (!isExtensionMethod(method)) return null;
  if (!isRecord(params)) return null;
  if (typeof params.method !== "string") return null;

  return makeCommand({
    method,
    params: {
      method: params.method,
      params: isRecord(params.params)
        ? (params.params as Record<string, unknown>)
        : undefined,
      targetId:
        typeof params.targetId === "string" ? params.targetId : undefined,
    },
  });
};

Bun.serve<WsData>({
  hostname: HOST,
  port: PORT,
  idleTimeout: 0,
  fetch(req, bunServer) {
    const url = new URL(req.url);

    // Health check (single endpoint)
    if (url.pathname === "/healthz") {
      if (req.method === "HEAD") return new Response(null, { status: 200 });
      if (req.method === "GET") {
        return json(
          {
            ok: true,
            extensionConnected:
              state.extension?.readyState === WebSocket.OPEN ? true : false,
          },
          { status: 200 },
        );
      }
      return new Response(null, { status: 405 });
    }

    const handleHttpCommand = async (): Promise<Response> => {
      const bodyText = await req.text();
      const body = safeJsonParse(bodyText);
      const command = parseHttpCommandBody(body);
      if (!command) {
        return json(
          { ok: false, error: "Unrecognized command shape" },
          { status: 400 },
        );
      }

      const ext = state.extension;
      if (!ext || ext.readyState !== WebSocket.OPEN) {
        return json(
          { ok: false, error: "Extension is not connected" },
          { status: 503 },
        );
      }

      return await new Promise<Response>((resolve) => {
        const timeoutId = setTimeout(() => {
          respondPending(command.id, {
            id: command.id,
            error: `Timeout after ${REQUEST_TIMEOUT_MS}ms`,
          });
        }, REQUEST_TIMEOUT_MS);

        state.pending.set(command.id, {
          resolve: (msg) => {
            const status = msg.error
              ? msg.error.startsWith("Timeout")
                ? 504
                : 502
              : 200;
            resolve(
              json(
                {
                  ok: msg.error ? false : true,
                  result: (msg.result ?? null) as Json,
                  error: msg.error ?? null,
                },
                { status },
              ),
            );
          },
          timeoutId,
        });

        wsSendJson(ext, command);
      });
    };

    // HTTP command bridge (primary public API)
    if (url.pathname === "/command" && req.method === "POST") {
      return handleHttpCommand();
    }

    // Server-Sent Events: stream extension events/logs/status over HTTP
    if (url.pathname === "/events" && req.method === "GET") {
      let controllerRef: ReadableStreamDefaultController<Uint8Array> | null =
        null;
      let keepaliveIdRef: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (keepaliveIdRef) {
          clearInterval(keepaliveIdRef);
          keepaliveIdRef = null;
        }
        if (controllerRef) {
          state.sseClients.delete(controllerRef);
          try {
            controllerRef.close();
          } catch {
            // ignore
          }
          controllerRef = null;
        }
      };

      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controllerRef = controller;
          state.sseClients.add(controller);

          // Initial hello
          try {
            controller.enqueue(
              textEncoder.encode(
                `data: ${JSON.stringify({
                  type: "hello",
                  extensionConnected:
                    state.extension?.readyState === WebSocket.OPEN
                      ? true
                      : false,
                })}\n\n`,
              ),
            );
          } catch {
            // ignore
          }

          const keepaliveId = setInterval(() => {
            try {
              // SSE comment line keeps proxies from buffering/closing
              controller.enqueue(textEncoder.encode(`: keepalive\n\n`));
            } catch {
              // ignore
            }
          }, SSE_KEEPALIVE_MS);
          keepaliveIdRef = keepaliveId;

          if (req.signal.aborted) cleanup();
          else req.signal.addEventListener("abort", cleanup, { once: true });
        },
        cancel() {
          cleanup();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        },
      });
    }

    // WebSocket endpoint (extension only)
    if (url.pathname === "/extension") {
      const role: WsRole = "extension";
      const upgraded = bunServer.upgrade(req, { data: { role } });
      if (upgraded) return new Response(null, { status: 101 });
      return new Response("Upgrade required", { status: 426 });
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      const role = ws.data.role;
      if (role === "extension") {
        if (state.extension && state.extension.readyState === WebSocket.OPEN) {
          log("warn", "Replacing existing extension connection");
          try {
            state.extension.close(1012, "Replaced");
          } catch {
            // ignore
          }
        }
        state.extension = ws;
        log("info", "Extension connected");
        startExtensionKeepalive(ws);
        sseBroadcast({ type: "status", extensionConnected: true });
        return;
      }
    },
    message(ws, data) {
      const text =
        typeof data === "string" ? data : new TextDecoder().decode(data);
      const parsed = safeJsonParse(text);
      const role = ws.data.role;

      if (role === "extension") {
        // Extension -> server: responses/events/logs
        if (isExtensionResponseMessage(parsed)) {
          const hadPending = state.pending.has(parsed.id);
          if (hadPending) respondPending(parsed.id, parsed);
          else
            sseBroadcast({
              type: "orphan-response",
              result: (parsed.result ?? null) as Json,
              error: parsed.error ?? null,
            });
          return;
        }

        if (isExtensionEventMessage(parsed) || isExtensionLogMessage(parsed)) {
          sseBroadcast(parsed);
          return;
        }

        // Unknown message, broadcast raw
        sseBroadcast({
          type: "unknown-from-extension",
          raw: parsed as Json,
        });
        return;
      }
    },
    close(ws, code, reason) {
      const role = ws.data.role;
      if (role === "extension") {
        // Stale/replaced sockets can still emit close; don't treat as a real disconnect.
        if (state.extension !== ws) {
          log("warn", "Stale extension socket closed", { code, reason });
          return;
        }

        state.extension = null;
        stopExtensionKeepalive();
        log("warn", "Extension disconnected", { code, reason });
        sseBroadcast({ type: "status", extensionConnected: false });
        return;
      }
    },
  },
});

log("info", `Relay listening on http://${HOST}:${PORT}`);
log("info", `WS extension endpoint: ws://${HOST}:${PORT}/extension`);
log("info", `HTTP command endpoint: http://${HOST}:${PORT}/command`);
log("info", `HTTP events (SSE) endpoint: http://${HOST}:${PORT}/events`);
