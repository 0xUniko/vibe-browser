// Get current active tab targetId from vibe-browser relay.
// Run: bun .agents/skills/vibe-browser/get-active-target.ts
// Env:
//   RELAY_URL=http://localhost:9222

const RELAY_URL = process.env.RELAY_URL ?? "http://localhost:9222";

type RelayResponse =
  | { ok?: boolean; result?: any; error?: string | null }
  | any;

const call = async (
  method: "tab" | "cdp",
  params: any,
): Promise<RelayResponse> => {
  const response = await fetch(`${RELAY_URL}/command`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ method, params }),
  });

  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${text}`);

  try {
    return JSON.parse(text);
  } catch {
    return text as any;
  }
};

const evalInPage = async (targetId: string, expression: string) => {
  return await call("cdp", {
    method: "Runtime.evaluate",
    targetId,
    params: { expression, returnByValue: true, awaitPromise: true },
  });
};

const main = async () => {
  console.log("Connecting to browser relay...", RELAY_URL);

  const active = await call("tab", { method: "tab.getActiveTarget" });
  const targetId = active?.result?.targetId;

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

  const url = urlRes?.result?.result?.value ?? "(unknown)";
  const title = titleRes?.result?.result?.value ?? "(unknown)";

  console.log(`targetId=${targetId}`);
  console.log(`url=${url}`);
  console.log(`title=${title}`);
};

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

export {};
