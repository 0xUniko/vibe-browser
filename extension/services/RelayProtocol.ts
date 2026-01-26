/**
 * Protocol types for extension <-> relay communication.
 */

export interface ExtensionCommandMessage {
  id: number;
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
