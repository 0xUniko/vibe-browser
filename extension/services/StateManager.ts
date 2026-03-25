/**
 * State storage (Effect service) - Manages active/inactive state with persistence.
 */

import { Context, Effect, Layer } from "effect";

const STORAGE_KEY = "vibeBrowserActiveState";
const LEGACY_STORAGE_KEY = "devBrowserActiveState";
export const DEFAULT_PORT = 9111;

export interface ActiveState {
  isActive: boolean;
  port: number;
}

export interface StateStore {
  get: Effect.Effect<ActiveState, unknown>;
  set: (state: ActiveState) => Effect.Effect<void, unknown>;
}

export const StateStore = Context.GenericTag<StateStore>("vibe/StateStore");

export const StateStoreLive = Layer.succeed(StateStore, {
  get: Effect.tryPromise(async () => {
    const result = await chrome.storage.local.get([
      STORAGE_KEY,
      LEGACY_STORAGE_KEY,
    ]);

    const state = result[STORAGE_KEY] as ActiveState | undefined;
    if (state) {
      if (typeof state.port === "number") {
        return state;
      }

      const migratedState: ActiveState = {
        isActive: state.isActive,
        port: DEFAULT_PORT,
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: migratedState });
      return migratedState;
    }

    const legacyState = result[LEGACY_STORAGE_KEY] as ActiveState | undefined;
    if (legacyState) {
      const migratedState: ActiveState = {
        isActive: legacyState.isActive,
        port:
          typeof legacyState.port === "number"
            ? legacyState.port
            : DEFAULT_PORT,
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: migratedState });
      await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
      return migratedState;
    }

    return { isActive: false, port: DEFAULT_PORT };
  }),
  set: (state) =>
    Effect.tryPromise(async () => {
      await chrome.storage.local.set({ [STORAGE_KEY]: state });
    }),
} satisfies StateStore);
