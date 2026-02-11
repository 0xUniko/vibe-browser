// Record browser Network events from a specific targetId via vibe-browser relay.
// This unified recorder captures both HTTP(S) requests and WebSocket traffic.
//
// Run:
//   bun .agents/skills/vibe-browser/record-network.ts <targetId> [outFile] [autoStopMs]
//
// Or:
//   TARGET_ID=... bun .agents/skills/vibe-browser/record-network.ts
//   OUT_FILE=...  bun .agents/skills/vibe-browser/record-network.ts
//
// Env:
//   RELAY_URL=http://localhost:9222
//   OUT_FILE=network-events.jsonl
//   AUTO_STOP_MS=30000
//   ALL_TARGETS=1          (record events from all targets, not only the provided targetId)
//   RAW=1                  (include raw forwardCDPEvent payloads)
//   INCLUDE_HTTP=0|1       (default: 1)
//   INCLUDE_WS=0|1         (default: 1)
//
// HTTP-specific env:
//   HTTP_ONLY=1            (only record http(s) URLs)
//   MAX_BODY_CHARS=0       (truncate request/response bodies; 0 means no truncation)
//
// WS-specific env:
//   URL_INCLUDES=...       (only record sockets whose URL includes this substring)
//   MAX_PAYLOAD_CHARS=0    (truncate ws frame payloadData; 0 means no truncation)
//   REDACT_HEADERS=1       (redact Cookie/Authorization headers in handshake records)
//
// Output formatting:
//   JSONL_INDENT=2         (pretty indent spaces per record; 0 means one-line JSON per record)

// TypeScript in this repo may not have Node types configured; Bun runtime still supports node built-ins.
// @ts-ignore
import { createWriteStream } from "node:fs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare const process: any;

const RELAY_URL = process.env.RELAY_URL ?? "http://localhost:9222";

const getPositionalArgs = (): string[] => {
  const args = Array.isArray(process.argv) ? process.argv.slice(2) : [];
  return args.filter((a: string) => a && !String(a).startsWith("-"));
};

const getTargetIdFromArgs = (): string | null => {
  const positional = getPositionalArgs();
  const fromArg = String(positional[0] ?? "").trim();
  if (fromArg) return fromArg;
  const fromEnv = String(process.env.TARGET_ID ?? "").trim();
  return fromEnv || null;
};

// Prefer CLI args over env vars so a lingering $env:OUT_FILE does not
// accidentally overwrite the wrong file.
const OUT_FILE = String(
  getPositionalArgs()[1] ?? process.env.OUT_FILE ?? "network-events.jsonl",
);

const AUTO_STOP_MS = (() => {
  const fromArgRaw = String(getPositionalArgs()[2] ?? "").trim();
  const fromArg = fromArgRaw ? Number.parseInt(fromArgRaw, 10) : 0;
  if (Number.isFinite(fromArg) && fromArg > 0) return fromArg;

  const fromEnvRaw = String(process.env.AUTO_STOP_MS ?? "").trim();
  const fromEnv = fromEnvRaw ? Number.parseInt(fromEnvRaw, 10) : 0;
  return Number.isFinite(fromEnv) ? fromEnv : 0;
})();

const JSONL_INDENT = process.env.JSONL_INDENT
  ? Number.parseInt(String(process.env.JSONL_INDENT), 10)
  : 2;

const ALL_TARGETS = process.env.ALL_TARGETS === "1";
const RAW = process.env.RAW === "1";
const INCLUDE_HTTP = process.env.INCLUDE_HTTP !== "0";
const INCLUDE_WS = process.env.INCLUDE_WS !== "0";

const HTTP_ONLY = process.env.HTTP_ONLY === "1";
const MAX_BODY_CHARS = process.env.MAX_BODY_CHARS
  ? Number.parseInt(process.env.MAX_BODY_CHARS, 10)
  : 0;

const URL_INCLUDES = String(process.env.URL_INCLUDES ?? "").trim();
const REDACT_HEADERS = process.env.REDACT_HEADERS === "1";
const MAX_PAYLOAD_CHARS = process.env.MAX_PAYLOAD_CHARS
  ? Number.parseInt(String(process.env.MAX_PAYLOAD_CHARS), 10)
  : 0;

type RelayCommandMethod = "tab" | "cdp";
type RelayOk = { ok: true; result: any; error: null };
type RelayErr = { ok: false; result: null; error: string | null };
type RelayResp = RelayOk | RelayErr;

const call = async (
  method: RelayCommandMethod,
  params: any,
): Promise<RelayResp> => {
  const res = await fetch(`${RELAY_URL}/command`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
  return JSON.parse(text) as RelayResp;
};

const nowIso = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class StopSignal {
  #stopped = false;
  #reason: string | null = null;
  #callbacks = new Set<() => void>();

  get stopped() {
    return this.#stopped;
  }

  get reason() {
    return this.#reason;
  }

  stop(reason?: string) {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#reason = reason ?? "stop";
    for (const cb of this.#callbacks) {
      try {
        cb();
      } catch {
        // ignore
      }
    }
    this.#callbacks.clear();
  }

  onStop(cb: () => void) {
    if (this.#stopped) {
      cb();
      return;
    }
    this.#callbacks.add(cb);
  }
}

class JsonlWriter {
  #stream: ReturnType<typeof createWriteStream>;
  #closed = false;
  #indent: number;
  #first = true;

  constructor(stream: ReturnType<typeof createWriteStream>, indent: number) {
    this.#stream = stream;
    this.#indent = indent;
  }

  write(obj: unknown) {
    if (this.#closed) return;
    const prefix = this.#first ? "" : "\n";
    this.#first = false;
    const text =
      this.#indent > 0
        ? JSON.stringify(obj, null, this.#indent)
        : JSON.stringify(obj);
    this.#stream.write(prefix + text + "\n");
  }

  async close() {
    if (this.#closed) return;
    this.#closed = true;
    await new Promise<void>((resolve) => this.#stream.end(resolve));
  }
}

type SseMessage = any;

const streamSse = async (
  url: string,
  onMessage: (msg: SseMessage) => void,
  stop: StopSignal,
) => {
  const controller = new AbortController();
  stop.onStop(() => controller.abort());

  const backoff = async (ms: number) => {
    if (stop.stopped) return;
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  };

  const isAbortError = (err: unknown): boolean => {
    const anyErr = err as any;
    if (!anyErr) return false;
    if (anyErr.name === "AbortError") return true;
    const msg = typeof anyErr.message === "string" ? anyErr.message : "";
    return msg.includes("aborted") || msg.includes("AbortError");
  };

  const decoder = new TextDecoder();

  while (!stop.stopped) {
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: { accept: "text/event-stream" },
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`SSE HTTP ${res.status}: ${text}`);
      }

      if (!res.body) throw new Error("SSE response has no body");

      const reader = res.body.getReader();
      let buffer = "";

      while (!stop.stopped) {
        let chunk;
        try {
          chunk = await reader.read();
        } catch (err) {
          if (controller.signal.aborted || stop.stopped || isAbortError(err))
            break;
          throw err;
        }

        const { value, done } = chunk;
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        while (true) {
          const sep = buffer.indexOf("\n\n");
          if (sep === -1) break;

          const rawEvent = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);

          const lines = rawEvent.split(/\r?\n/);
          const dataLines = lines
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice("data:".length).trimStart());

          if (dataLines.length === 0) continue;
          const dataText = dataLines.join("\n");

          try {
            onMessage(JSON.parse(dataText));
          } catch {
            onMessage({ method: "sse_parse_error", raw: dataText });
          }
        }
      }

      try {
        await reader.cancel();
      } catch {
        // ignore
      }

      // If server closes stream, reconnect unless stopping.
      await backoff(250);
    } catch (err) {
      if (controller.signal.aborted || stop.stopped || isAbortError(err))
        return;
      await backoff(500);
    }
  }
};

const truncateBody = (body: string) => {
  if (!Number.isFinite(MAX_BODY_CHARS) || MAX_BODY_CHARS <= 0) {
    return { text: body, truncated: false, originalLength: body.length };
  }
  if (body.length <= MAX_BODY_CHARS) {
    return { text: body, truncated: false, originalLength: body.length };
  }
  return {
    text:
      body.slice(0, MAX_BODY_CHARS) +
      `\n[truncated to ${MAX_BODY_CHARS} chars]`,
    truncated: true,
    originalLength: body.length,
  };
};

const truncateText = (text: string) => {
  if (!MAX_PAYLOAD_CHARS || MAX_PAYLOAD_CHARS <= 0) {
    return { text, truncated: false, originalLength: text.length };
  }
  if (text.length <= MAX_PAYLOAD_CHARS) {
    return { text, truncated: false, originalLength: text.length };
  }
  return {
    text: text.slice(0, MAX_PAYLOAD_CHARS),
    truncated: true,
    originalLength: text.length,
  };
};

const redactHeaderMap = (headers: unknown): unknown => {
  if (!REDACT_HEADERS) return headers;
  if (!headers || typeof headers !== "object") return headers;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
    const key = String(k).toLowerCase();
    if (
      key === "cookie" ||
      key === "authorization" ||
      key === "proxy-authorization"
    ) {
      out[k] = "[REDACTED]";
      continue;
    }
    out[k] = v;
  }
  return out;
};

type HttpRecord = {
  type: "http";
  at: string;
  targetId: string | null;
  requestId: string;
  loaderId?: string | null;
  frameId?: string | null;
  documentURL?: string | null;
  initiator?: any;
  request: {
    url: string;
    method: string;
    headers?: Record<string, unknown> | null;
    headersExtraInfo?: Record<string, unknown> | null;
    extraInfo?: any;
    referrerPolicy?: string | null;
    postData?: string | null;
    postDataTruncated?: boolean;
    postDataOriginalLength?: number | null;
  };
  response?: {
    url?: string | null;
    status?: number | null;
    statusText?: string | null;
    mimeType?: string | null;
    protocol?: string | null;
    remoteIPAddress?: string | null;
    remotePort?: number | null;
    fromDiskCache?: boolean;
    fromServiceWorker?: boolean;
    headers?: Record<string, unknown> | null;
    headersExtraInfo?: Record<string, unknown> | null;
    extraInfo?: any;
    body?: string | null;
    bodyBase64Encoded?: boolean;
    bodyTruncated?: boolean;
    bodyOriginalLength?: number | null;
    bodyError?: string | null;
  };
  error?: {
    errorText?: string | null;
    canceled?: boolean;
    blockedReason?: string | null;
  };
  raw?: any[];
};

type ConnMeta = {
  requestId: string;
  targetId: string | null;
  url: string | null;
  createdAt: string | null;
  filteredOut: boolean;
};

const main = async () => {
  if (!INCLUDE_HTTP && !INCLUDE_WS) {
    throw new Error("Both INCLUDE_HTTP and INCLUDE_WS are disabled.");
  }

  const outFileLower = OUT_FILE.toLowerCase();
  if (!outFileLower.endsWith(".jsonl")) {
    throw new Error(
      `OUT_FILE must end with .jsonl (got: ${OUT_FILE}). This recorder only writes JSONL.`,
    );
  }

  const targetId = getTargetIdFromArgs();
  if (!targetId) {
    throw new Error(
      "Missing targetId. Usage: bun .agents/skills/vibe-browser/record-network.ts <targetId> (or set env TARGET_ID)",
    );
  }

  const indent = Number.isFinite(JSONL_INDENT) ? Math.max(0, JSONL_INDENT) : 2;
  const out = createWriteStream(OUT_FILE, { flags: "w" });
  const writer = new JsonlWriter(out, indent);
  const stop = new StopSignal();
  const eventsUrl = `${RELAY_URL}/events`;

  const httpRecords = new Map<string, HttpRecord>();
  const wsConns = new Map<string, ConnMeta>();

  let cleaned = false;

  const emitHttpAndDelete = (requestId: string) => {
    const rec = httpRecords.get(requestId);
    if (!rec) return;
    writer.write(rec);
    httpRecords.delete(requestId);
  };

  const getWsConn = (requestId: string, evTargetId?: string | null): ConnMeta => {
    const existing = wsConns.get(requestId);
    if (existing) {
      if (!existing.targetId && evTargetId) existing.targetId = evTargetId;
      return existing;
    }
    const conn: ConnMeta = {
      requestId,
      targetId: evTargetId ?? null,
      url: null,
      createdAt: null,
      filteredOut: false,
    };
    wsConns.set(requestId, conn);
    return conn;
  };

  const isWsFilteredOut = (conn: ConnMeta) => {
    if (conn.filteredOut) return true;
    if (!URL_INCLUDES) return false;
    if (!conn.url) return false;
    conn.filteredOut = !conn.url.includes(URL_INCLUDES);
    return conn.filteredOut;
  };

  const fetchRequestPostData = async (
    requestId: string,
    forTargetId: string,
  ) => {
    const resp = await call("cdp", {
      method: "Network.getRequestPostData",
      targetId: forTargetId,
      params: { requestId },
    }).catch(() => null);

    if (!resp || !resp.ok) return null;
    const postData = resp?.result?.postData;
    if (typeof postData !== "string") return null;
    return truncateBody(postData);
  };

  const fetchResponseBody = async (requestId: string, forTargetId: string) => {
    const resp = await call("cdp", {
      method: "Network.getResponseBody",
      targetId: forTargetId,
      params: { requestId },
    }).catch(() => null);

    if (!resp) {
      return {
        body: null as string | null,
        base64Encoded: false,
        error: "cdp_call_failed" as string | null,
      };
    }
    if (!resp.ok) {
      return {
        body: null as string | null,
        base64Encoded: false,
        error: resp.error || "Network.getResponseBody failed",
      };
    }
    const body = resp?.result?.body;
    const base64Encoded = !!resp?.result?.base64Encoded;
    if (typeof body !== "string") {
      return {
        body: null as string | null,
        base64Encoded,
        error: "response_body_not_string" as string | null,
      };
    }
    const t = truncateBody(body);
    return {
      body: t.text,
      base64Encoded,
      truncated: t.truncated,
      originalLength: t.originalLength,
      error: null as string | null,
    };
  };

  const cleanup = async (reason: string) => {
    if (cleaned) return;
    cleaned = true;
    stop.stop(reason);

    for (const id of Array.from(httpRecords.keys())) {
      emitHttpAndDelete(id);
    }

    writer.write({ type: "recorder_stop", at: nowIso(), reason });
    await call("cdp", { method: "Network.disable", targetId, params: {} }).catch(
      () => null,
    );
    await call("cdp", { method: "Page.disable", targetId, params: {} }).catch(
      () => null,
    );
    await writer.close();
  };

  process.once("SIGINT", () => void cleanup("SIGINT"));
  process.once("SIGTERM", () => void cleanup("SIGTERM"));

  if (Number.isFinite(AUTO_STOP_MS) && AUTO_STOP_MS > 0) {
    setTimeout(
      () => void cleanup(`AUTO_STOP_MS=${AUTO_STOP_MS}`),
      AUTO_STOP_MS,
    );
  }

  writer.write({
    type: "recorder_start",
    at: nowIso(),
    relayUrl: RELAY_URL,
    outFile: OUT_FILE,
    jsonlIndent: indent,
    targetId,
    allTargets: ALL_TARGETS,
    raw: RAW,
    includeHttp: INCLUDE_HTTP,
    includeWs: INCLUDE_WS,
    httpOnly: HTTP_ONLY,
    maxBodyChars: MAX_BODY_CHARS,
    urlIncludes: URL_INCLUDES || null,
    maxPayloadChars: MAX_PAYLOAD_CHARS,
    redactHeaders: REDACT_HEADERS,
  });

  const enabled = await call("cdp", {
    method: "Network.enable",
    targetId,
    // Do not set 0-sized buffers.
    params: {},
  });
  if (!enabled.ok) {
    throw new Error(enabled.error || "Network.enable failed");
  }
  await call("cdp", { method: "Page.enable", targetId, params: {} }).catch(
    () => null,
  );

  const onHttpEvent = (
    evMethod: string,
    evParams: any,
    evTargetId: string | null,
    rawMsg: any,
  ) => {
    if (!INCLUDE_HTTP) return;
    if (evMethod.startsWith("Network.webSocket")) return;

    const requestId = String(evParams?.requestId ?? "");
    if (!requestId) return;

    if (evMethod === "Network.requestWillBeSent") {
      const req = evParams?.request;
      const url = String(req?.url ?? "");
      if (
        HTTP_ONLY &&
        !url.startsWith("http://") &&
        !url.startsWith("https://")
      )
        return;

      const rec: HttpRecord = {
        type: "http",
        at: nowIso(),
        targetId: evTargetId ?? null,
        requestId,
        loaderId: evParams?.loaderId ?? null,
        frameId: evParams?.frameId ?? null,
        documentURL: evParams?.documentURL ?? null,
        initiator: evParams?.initiator ?? null,
        request: {
          url,
          method: String(req?.method ?? ""),
          headers:
            req?.headers && typeof req.headers === "object"
              ? req.headers
              : null,
          headersExtraInfo: null,
          extraInfo: null,
          referrerPolicy: req?.referrerPolicy ?? null,
          postData: null,
          postDataTruncated: false,
          postDataOriginalLength: null,
        },
        ...(RAW ? { raw: [rawMsg] } : {}),
      };

      httpRecords.set(requestId, rec);

      const hasPostData = !!req?.hasPostData;
      const methodUpper = String(req?.method ?? "").toUpperCase();
      const shouldTryPost =
        hasPostData || (methodUpper !== "GET" && methodUpper !== "HEAD");
      const tid = evTargetId ?? targetId;
      if (shouldTryPost && tid) {
        void (async () => {
          const postData = await fetchRequestPostData(requestId, tid);
          const current = httpRecords.get(requestId);
          if (!current) return;
          if (postData !== null) {
            current.request.postData = postData.text;
            current.request.postDataTruncated = postData.truncated;
            current.request.postDataOriginalLength = postData.originalLength;
          }
        })();
      }
      return;
    }

    if (evMethod === "Network.requestWillBeSentExtraInfo") {
      const current = httpRecords.get(requestId);
      if (!current) return;
      const hdrs = evParams?.headers;
      if (hdrs && typeof hdrs === "object") {
        current.request.headersExtraInfo = hdrs;
      }
      current.request.extraInfo = evParams ?? null;
      if (RAW) current.raw?.push(rawMsg);
      return;
    }

    if (evMethod === "Network.responseReceived") {
      const resp = evParams?.response;
      const url = String(resp?.url ?? "");
      if (
        HTTP_ONLY &&
        !url.startsWith("http://") &&
        !url.startsWith("https://")
      )
        return;

      const current = httpRecords.get(requestId) ?? {
        type: "http" as const,
        at: nowIso(),
        targetId: evTargetId ?? null,
        requestId,
        request: {
          url,
          method: "",
          headers: null,
          headersExtraInfo: null,
          extraInfo: null,
          referrerPolicy: null,
          postData: null,
          postDataTruncated: false,
          postDataOriginalLength: null,
        },
        ...(RAW ? { raw: [rawMsg] } : {}),
      };

      current.targetId = current.targetId ?? evTargetId ?? null;
      current.response = {
        url,
        status: typeof resp?.status === "number" ? resp.status : null,
        statusText: resp?.statusText ?? null,
        mimeType: resp?.mimeType ?? null,
        protocol: resp?.protocol ?? null,
        remoteIPAddress: resp?.remoteIPAddress ?? null,
        remotePort:
          typeof resp?.remotePort === "number" ? resp.remotePort : null,
        fromDiskCache: !!resp?.fromDiskCache,
        fromServiceWorker: !!resp?.fromServiceWorker,
        headers:
          resp?.headers && typeof resp.headers === "object"
            ? resp.headers
            : null,
        headersExtraInfo: current.response?.headersExtraInfo ?? null,
        extraInfo: current.response?.extraInfo ?? null,
        body: current.response?.body ?? null,
        bodyBase64Encoded: current.response?.bodyBase64Encoded ?? false,
        bodyTruncated: current.response?.bodyTruncated ?? false,
        bodyOriginalLength: current.response?.bodyOriginalLength ?? null,
        bodyError: current.response?.bodyError ?? null,
      };

      httpRecords.set(requestId, current);
      return;
    }

    if (evMethod === "Network.responseReceivedExtraInfo") {
      const current = httpRecords.get(requestId);
      if (!current) return;
      const hdrs = evParams?.headers;
      if (hdrs && typeof hdrs === "object") {
        if (!current.response) {
          current.response = {
            headers: null,
            headersExtraInfo: hdrs,
          } as any;
        } else {
          current.response.headersExtraInfo = hdrs;
        }
      }
      if (!current.response) current.response = {};
      current.response.extraInfo = evParams ?? null;
      if (RAW) current.raw?.push(rawMsg);
      return;
    }

    if (evMethod === "Network.loadingFinished") {
      const current = httpRecords.get(requestId);
      if (!current) return;
      const tid = (evTargetId ?? current.targetId ?? targetId) as string;
      if (tid) {
        void (async () => {
          const body = await fetchResponseBody(requestId, tid);
          const rec = httpRecords.get(requestId);
          if (!rec) return;
          rec.response = rec.response ?? {};
          if (body.body !== null) {
            rec.response.body = body.body;
            rec.response.bodyBase64Encoded = body.base64Encoded;
            rec.response.bodyTruncated = (body as any).truncated ?? false;
            rec.response.bodyOriginalLength =
              (body as any).originalLength ?? body.body?.length ?? null;
          }
          if (body.error) {
            rec.response.bodyError = body.error;
          }
          if (RAW) rec.raw?.push(rawMsg);
          emitHttpAndDelete(requestId);
        })();
      } else {
        if (RAW) current.raw?.push(rawMsg);
        emitHttpAndDelete(requestId);
      }
      return;
    }

    if (evMethod === "Network.loadingFailed") {
      const current = httpRecords.get(requestId) ?? {
        type: "http" as const,
        at: nowIso(),
        targetId: evTargetId ?? null,
        requestId,
        request: {
          url: "",
          method: "",
          headers: null,
          headersExtraInfo: null,
          extraInfo: null,
          referrerPolicy: null,
          postData: null,
          postDataTruncated: false,
          postDataOriginalLength: null,
        },
        ...(RAW ? { raw: [rawMsg] } : {}),
      };
      current.error = {
        errorText: evParams?.errorText ?? null,
        canceled: !!evParams?.canceled,
        blockedReason: evParams?.blockedReason ?? null,
      };
      httpRecords.set(requestId, current);
      if (RAW) current.raw?.push(rawMsg);
      emitHttpAndDelete(requestId);
      return;
    }

    if (RAW) {
      const current = httpRecords.get(requestId);
      if (current) current.raw?.push(rawMsg);
    }
  };

  const onWsEvent = (
    evMethod: string,
    evParams: any,
    evTargetId: string | null,
    rawMsg: any,
  ) => {
    if (!INCLUDE_WS) return;
    if (!evMethod.startsWith("Network.webSocket")) return;

    const requestId = String(evParams?.requestId ?? "");
    if (!requestId) return;
    const conn = getWsConn(requestId, evTargetId);

    if (evMethod === "Network.webSocketCreated") {
      const url = typeof evParams?.url === "string" ? evParams.url : null;
      conn.url = conn.url ?? url;
      conn.createdAt = conn.createdAt ?? nowIso();
      if (isWsFilteredOut(conn)) return;

      writer.write({
        type: "ws_created",
        at: nowIso(),
        targetId: conn.targetId,
        requestId,
        url: conn.url,
        initiator: evParams?.initiator ?? null,
        ...(RAW ? { raw: rawMsg ?? null } : {}),
      });
      return;
    }

    if (typeof evParams?.url === "string" && !conn.url) conn.url = evParams.url;
    if (isWsFilteredOut(conn)) return;

    if (evMethod === "Network.webSocketWillSendHandshakeRequest") {
      writer.write({
        type: "ws_handshake_request",
        at: nowIso(),
        targetId: conn.targetId,
        requestId,
        url: conn.url,
        timestamp: typeof evParams?.timestamp === "number" ? evParams.timestamp : null,
        request: {
          headers: redactHeaderMap(evParams?.request?.headers ?? null),
        },
        ...(RAW ? { raw: rawMsg ?? null } : {}),
      });
      return;
    }

    if (evMethod === "Network.webSocketHandshakeResponseReceived") {
      writer.write({
        type: "ws_handshake_response",
        at: nowIso(),
        targetId: conn.targetId,
        requestId,
        url: conn.url,
        timestamp: typeof evParams?.timestamp === "number" ? evParams.timestamp : null,
        response: {
          status: typeof evParams?.response?.status === "number" ? evParams.response.status : null,
          statusText:
            typeof evParams?.response?.statusText === "string"
              ? evParams.response.statusText
              : null,
          headers: redactHeaderMap(evParams?.response?.headers ?? null),
          headersText:
            typeof evParams?.response?.headersText === "string"
              ? evParams.response.headersText
              : null,
        },
        ...(RAW ? { raw: rawMsg ?? null } : {}),
      });
      return;
    }

    if (
      evMethod === "Network.webSocketFrameSent" ||
      evMethod === "Network.webSocketFrameReceived"
    ) {
      const response = evParams?.response ?? {};
      const payloadRaw =
        typeof response?.payloadData === "string" ? response.payloadData : "";
      const trunc = truncateText(payloadRaw);
      writer.write({
        type: "ws_frame",
        at: nowIso(),
        targetId: conn.targetId,
        requestId,
        url: conn.url,
        direction: evMethod.endsWith("Sent") ? "sent" : "received",
        timestamp: typeof evParams?.timestamp === "number" ? evParams.timestamp : null,
        opcode: typeof response?.opcode === "number" ? response.opcode : null,
        mask: typeof response?.mask === "boolean" ? response.mask : null,
        payloadData: trunc.text,
        payloadTruncated: trunc.truncated,
        payloadOriginalLength: trunc.originalLength,
        ...(RAW ? { raw: rawMsg ?? null } : {}),
      });
      return;
    }

    if (evMethod === "Network.webSocketClosed") {
      writer.write({
        type: "ws_closed",
        at: nowIso(),
        targetId: conn.targetId,
        requestId,
        url: conn.url,
        timestamp: typeof evParams?.timestamp === "number" ? evParams.timestamp : null,
        ...(RAW ? { raw: rawMsg ?? null } : {}),
      });
      wsConns.delete(requestId);
      return;
    }

    if (evMethod === "Network.webSocketFrameError") {
      writer.write({
        type: "ws_frame_error",
        at: nowIso(),
        targetId: conn.targetId,
        requestId,
        url: conn.url,
        timestamp: typeof evParams?.timestamp === "number" ? evParams.timestamp : null,
        errorMessage:
          typeof evParams?.errorMessage === "string" ? evParams.errorMessage : null,
        ...(RAW ? { raw: rawMsg ?? null } : {}),
      });
    }
  };

  const onMsg = (msg: any) => {
    const method = msg?.method;
    if (method === "sse_parse_error") {
      writer.write({ type: "sse_parse_error", at: nowIso(), raw: msg?.raw });
      return;
    }
    if (method === "status") {
      writer.write({ type: "status", at: nowIso(), ...msg });
      return;
    }
    if (method !== "forwardCDPEvent") return;

    const evMethod = msg?.params?.method as string | undefined;
    const evParams = msg?.params?.params as any;
    const evTargetIdRaw = msg?.params?.targetId;
    const evTargetId =
      typeof evTargetIdRaw === "string" ? evTargetIdRaw : null;

    if (!evMethod) return;
    if (!ALL_TARGETS && evTargetId && evTargetId !== targetId) return;

    onHttpEvent(evMethod, evParams, evTargetId, msg);
    onWsEvent(evMethod, evParams, evTargetId, msg);
  };

  process.stdout.write(
    `✓ recorder: targetId=${targetId}\n` +
      `✓ recording network events via ${RELAY_URL}\n` +
      `✓ output: ${OUT_FILE}\n` +
      `✓ include: ${INCLUDE_HTTP ? "http " : ""}${INCLUDE_WS ? "ws" : ""}\n` +
      (URL_INCLUDES ? `✓ ws filter: URL_INCLUDES=${URL_INCLUDES}\n` : "") +
      (AUTO_STOP_MS > 0
        ? `✓ auto-stop in ${AUTO_STOP_MS}ms\n`
        : "✓ stop: press Ctrl+C\n"),
  );

  // Small delay so enable commands flush before we start consuming.
  await sleep(150);

  try {
    await streamSse(eventsUrl, onMsg, stop);
  } finally {
    await cleanup(stop.reason ?? "stream_end");
  }
};

await main();
