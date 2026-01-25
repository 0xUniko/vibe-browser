/**
 * State storage (Effect service) - Manages active/inactive state with persistence.
 */

import { Context, Effect, Layer } from "effect";

const STORAGE_KEY = "vibeBrowserActiveState";
const LEGACY_STORAGE_KEY = "devBrowserActiveState";

export interface ActiveState {
  isActive: boolean;
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
    if (state) return state;

    const legacyState = result[LEGACY_STORAGE_KEY] as ActiveState | undefined;
    if (legacyState) {
      await chrome.storage.local.set({ [STORAGE_KEY]: legacyState });
      await chrome.storage.local.remove(LEGACY_STORAGE_KEY);
      return legacyState;
    }

    return { isActive: false };
  }),
  set: (state) =>
    Effect.tryPromise(async () => {
      await chrome.storage.local.set({ [STORAGE_KEY]: state });
    }),
} satisfies StateStore);
