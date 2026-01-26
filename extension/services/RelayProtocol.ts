/**
 * Protocol types for extension <-> relay communication.
 */

export interface ExtensionCommandMessage {
  /** Correlation id for a single HTTP request bridged through WS. */
  id: number;
  method: "cdp" | "tab";
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

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null;

export const isExtensionCommandMessage = (
  v: unknown,
): v is ExtensionCommandMessage => {
  if (!isRecord(v)) return false;
  if (typeof v.id !== "number") return false;
  if (v.method !== "cdp" && v.method !== "tab") return false;
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
