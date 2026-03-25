/**
 * Popup <-> Background messaging types.
 */

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
}

export type PopupMessage = GetStateMessage | SetStateMessage | SetPortMessage;
