/**
 * Tab registry (Effect service) - Manages tab state and debugger attachment.
 */

import { Context, Effect, Layer, Ref } from "effect";
import { Connection } from "./ConnectionManager";

export type TabState = "connecting" | "connected" | "error";

export interface TabInfo {
  targetId?: string;
  state: TabState;
  errorText?: string;
}

export interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached?: boolean;
}

export interface TabRegistry {
  get: (tabId: number) => Effect.Effect<TabInfo | undefined, unknown>;
  has: (tabId: number) => Effect.Effect<boolean, unknown>;
  set: (tabId: number, info: TabInfo) => Effect.Effect<void, unknown>;
  getByTargetId: (
    targetId: string,
  ) => Effect.Effect<{ tabId: number; tab: TabInfo } | undefined, unknown>;
  attach: (tabId: number) => Effect.Effect<{ targetInfo: TargetInfo }, unknown>;
  detach: (
    tabId: number,
    shouldDetachDebugger: boolean,
  ) => Effect.Effect<void, unknown>;
  handleDebuggerDetach: (tabId: number) => Effect.Effect<void, unknown>;
  detachAll: Effect.Effect<void, unknown>;
}

export const TabRegistry = Context.GenericTag<TabRegistry>("vibe/TabRegistry");

export const TabRegistryLive = Layer.effect(
  TabRegistry,
  Effect.gen(function* () {
    const connection = yield* Connection;

    const tabsRef = yield* Ref.make<ReadonlyMap<number, TabInfo>>(new Map());

    const setTab = (tabId: number, info: TabInfo) =>
      Ref.update(tabsRef, (tabs) => {
        const next = new Map(tabs);
        next.set(tabId, info);
        return next;
      });

    const deleteTab = (tabId: number) =>
      Ref.update(tabsRef, (tabs) => {
        const next = new Map(tabs);
        next.delete(tabId);
        return next;
      });

    const getByTargetId: TabRegistry["getByTargetId"] = (targetId) =>
      Ref.get(tabsRef).pipe(
        Effect.map((tabs) => {
          for (const [tabId, tab] of tabs) {
            if (tab.targetId === targetId) return { tabId, tab };
          }
          return undefined;
        }),
      );

    const attach: TabRegistry["attach"] = (tabId) =>
      Effect.gen(function* () {
        const debuggee = { tabId };
        yield* Effect.tryPromise(() => chrome.debugger.attach(debuggee, "1.3"));

        const result = (yield* Effect.tryPromise(() =>
          chrome.debugger.sendCommand(debuggee, "Target.getTargetInfo"),
        )) as { targetInfo: TargetInfo };

        const targetInfo = result.targetInfo;
        yield* setTab(tabId, {
          targetId: targetInfo.targetId,
          state: "connected",
        });

        yield* connection.send({
          method: "forwardCDPEvent",
          params: {
            targetId: targetInfo.targetId,
            method: "Target.attachedToTarget",
            params: {
              targetInfo: { ...targetInfo, attached: true },
              waitingForDebugger: false,
            },
          },
        });
        return { targetInfo };
      });

    const detach: TabRegistry["detach"] = (tabId, shouldDetachDebugger) =>
      Effect.gen(function* () {
        const tabs = yield* Ref.get(tabsRef);
        const tab = tabs.get(tabId);
        if (!tab) return;

        yield* connection.send({
          method: "forwardCDPEvent",
          params: {
            method: "Target.detachedFromTarget",
            targetId: tab.targetId,
            params: { targetId: tab.targetId },
          },
        });

        yield* deleteTab(tabId);

        if (shouldDetachDebugger) {
          yield* Effect.tryPromise(() =>
            chrome.debugger.detach({ tabId }),
          ).pipe(Effect.catchAll(() => Effect.void));
        }
      });

    const handleDebuggerDetach: TabRegistry["handleDebuggerDetach"] = (tabId) =>
      Effect.gen(function* () {
        const tabs = yield* Ref.get(tabsRef);
        const tab = tabs.get(tabId);
        if (!tab) return;

        yield* connection.send({
          method: "forwardCDPEvent",
          params: {
            method: "Target.detachedFromTarget",
            targetId: tab.targetId,
            params: { targetId: tab.targetId },
          },
        });
        yield* deleteTab(tabId);
      });

    const detachAll = Effect.gen(function* () {
      const tabs = yield* Ref.get(tabsRef);
      for (const tabId of tabs.keys()) {
        yield* Effect.tryPromise(() => chrome.debugger.detach({ tabId })).pipe(
          Effect.catchAll(() => Effect.void),
        );
      }
      yield* Ref.set(tabsRef, new Map());
    });

    return {
      get: (tabId) =>
        Ref.get(tabsRef).pipe(Effect.map((tabs) => tabs.get(tabId))),
      has: (tabId) =>
        Ref.get(tabsRef).pipe(Effect.map((tabs) => tabs.has(tabId))),
      set: setTab,
      getByTargetId,
      attach,
      detach,
      handleDebuggerDetach,
      detachAll,
    } satisfies TabRegistry;
  }),
);
