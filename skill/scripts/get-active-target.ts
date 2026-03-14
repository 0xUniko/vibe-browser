// Get current active tab targetId from vibe-browser relay.
// Run: bun .agents/skills/vibe-browser/scripts/get-active-target.ts
// Env:
//   RELAY_URL=http://localhost:9222

const RELAY_URL = process.env.RELAY_URL ?? "http://localhost:9222";

declare const process: {
  env: Record<string, string | undefined>;
  exitCode?: number;
};

type JsonObject = Record<string, unknown>;

type RelayCommandMethod = "tab" | "cdp";

type RelayResponse = {
  ok: boolean;
  result: unknown;
  error: string | null;
};

type HealthResponse = {
  ok: boolean;
  extensionConnected: boolean;
  action?: string | null;
  checks?: {
    activeTargetProbe?: {
      message?: string;
    };
  };
};

type EvaluateResultEnvelope = {
  result?: {
    type?: string;
    value?: unknown;
    description?: string;
  };
  exceptionDetails?: unknown;
};

const isRecord = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null;

const parseJsonResponse = async <T>(response: Response): Promise<T> => {
  return (await response.json()) as T;
};

const assertRelayHealthy = async (): Promise<void> => {
  let response: Response;
  try {
    response = await fetch(`${RELAY_URL}/health`);
  } catch {
    throw new Error(
      `Relay is unreachable at ${RELAY_URL}. Ask the user to manually start it with: bun .agents/skills/vibe-browser/scripts/relay.ts`,
    );
  }

  const payload = await parseJsonResponse<HealthResponse>(response);
  if (response.ok && payload.ok) return;

  const probeMessage = payload.checks?.activeTargetProbe?.message;
  const action = payload.action ?? "Ask the user to manually recover the relay and extension.";
  const detail = probeMessage ? `${probeMessage} ${action}` : action;

  throw new Error(
    `Relay is not ready at ${RELAY_URL}. ${detail}`.trim(),
  );
};

const call = async (
  method: RelayCommandMethod,
  params: JsonObject,
): Promise<RelayResponse> => {
  const response = await fetch(`${RELAY_URL}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });

  const payload = await parseJsonResponse<RelayResponse>(response);
  if (!response.ok) {
    throw new Error(payload.error ?? `HTTP ${response.status}`);
  }
  return payload;
};

const evalInPage = async (
  targetId: string,
  expression: string,
): Promise<RelayResponse> => {
  return call("cdp", {
    method: "Runtime.evaluate",
    targetId,
    params: { expression, returnByValue: true, awaitPromise: true },
  });
};

const getNestedValue = (payload: unknown): string => {
  if (!isRecord(payload)) return "(unknown)";
  const result = payload as EvaluateResultEnvelope;
  if (typeof result.result?.value === "string") {
    return result.result.value;
  }
  if (typeof result.result?.description === "string") {
    return result.result.description;
  }
  return "(unknown)";
};

const main = async (): Promise<void> => {
  console.log("Checking relay health...", RELAY_URL);
  await assertRelayHealthy();

  const active = await call("tab", { method: "tab.getActiveTarget" });
  const targetResult = isRecord(active.result) ? active.result : null;
  const targetId = targetResult?.targetId;

  if (typeof targetId !== "string" || !targetId.trim()) {
    console.error("Failed to get active tab targetId");
    if (process.env.RAW === "1") {
      console.error("raw:", JSON.stringify(active, null, 2));
    }
    process.exitCode = 1;
    return;
  }

  const urlRes = await evalInPage(targetId, "location.href");
  const titleRes = await evalInPage(targetId, "document.title");

  console.log(`targetId=${targetId}`);
  console.log(`url=${getNestedValue(urlRes.result)}`);
  console.log(`title=${getNestedValue(titleRes.result)}`);
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
