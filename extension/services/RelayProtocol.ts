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

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ExtensionErrorInfo {
  code: string;
  message: string;
  details?: { [key: string]: JsonValue };
  cause?: string;
}

export interface ExtensionResponseMessage {
  id: number;
  result?: unknown;
  error?: string;
  errorInfo?: ExtensionErrorInfo;
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

export const isExtensionErrorInfo = (v: unknown): v is ExtensionErrorInfo => {
  if (!isRecord(v)) return false;
  if (typeof v.code !== "string") return false;
  if (typeof v.message !== "string") return false;
  if (v.details !== undefined && !isRecord(v.details)) return false;
  if (v.cause !== undefined && typeof v.cause !== "string") return false;
  return true;
};

export const errorToMessage = (error: unknown): string => {
  if (isExtensionErrorInfo(error)) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
};

export const createExtensionErrorInfo = (
  code: string,
  message: string,
  options?: {
    details?: { [key: string]: JsonValue };
    cause?: unknown;
  },
): ExtensionErrorInfo => {
  const cause =
    options?.cause === undefined ? undefined : errorToMessage(options.cause);

  return {
    code,
    message,
    ...(options?.details ? { details: options.details } : {}),
    ...(cause ? { cause } : {}),
  };
};

export const toExtensionErrorInfo = (
  error: unknown,
  fallback?: {
    code?: string;
    message?: string;
    details?: { [key: string]: JsonValue };
  },
): ExtensionErrorInfo => {
  if (isExtensionErrorInfo(error)) {
    return {
      code: fallback?.code ?? error.code,
      message: fallback?.message ?? error.message,
      ...(error.details || fallback?.details
        ? {
            details: {
              ...(error.details ?? {}),
              ...(fallback?.details ?? {}),
            },
          }
        : {}),
      ...(error.cause ? { cause: error.cause } : {}),
    };
  }

  return createExtensionErrorInfo(
    fallback?.code ?? "UNEXPECTED_ERROR",
    fallback?.message ?? errorToMessage(error),
    {
      details: fallback?.details,
      cause: error,
    },
  );
};

export const toExtensionErrorResponse = (
  id: number,
  error: unknown,
  fallback?: {
    code?: string;
    message?: string;
    details?: { [key: string]: JsonValue };
  },
): ExtensionResponseMessage => {
  const errorInfo = toExtensionErrorInfo(error, fallback);

  return {
    id,
    error: errorInfo.message,
    errorInfo,
  };
};

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
