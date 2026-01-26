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

export interface StateResponse {
  isActive: boolean;
  isConnected: boolean;
}

export type PopupMessage = GetStateMessage | SetStateMessage;
