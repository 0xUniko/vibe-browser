/**
 * Popup <-> Background messaging types.
 */

import type { ExtensionErrorInfo } from "../../services/RelayProtocol";

export interface GetStateMessage {
  type: "getState";
}

export interface SetStateMessage {
  type: "setState";
  isActive: boolean;
}

export interface SetPortMessage {
  type: "setPort";
  port: number;
}

export interface StateResponse {
  isActive: boolean;
  isConnected: boolean;
  port: number;
  error?: string;
  errorInfo?: ExtensionErrorInfo;
}

export type PopupMessage = GetStateMessage | SetStateMessage | SetPortMessage;
