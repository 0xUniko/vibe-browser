/**
 * Tab registry (Effect service) - Manages tab state and debugger attachment.
 */

import { Context, Effect, Layer, Ref } from "effect";
import { Connection } from "./ConnectionManager";
import type { ExtensionCommandMessage } from "./RelayProtocol";

export interface ActiveTarget {
  tabId: number;
  targetId: string;
}

export interface TargetInfo {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached?: boolean;
}

export interface TabRegistry {
  getTargetId: (tabId: number) => Effect.Effect<string | undefined, unknown>;
  has: (tabId: number) => Effect.Effect<boolean, unknown>;
  attach: (tabId: number) => Effect.Effect<{ targetInfo: TargetInfo }, unknown>;
  detach: (
    tabId: number,
    shouldDetachDebugger: boolean,
  ) => Effect.Effect<void, unknown>;
  handleDebuggerDetach: (tabId: number) => Effect.Effect<void, unknown>;
  detachAll: Effect.Effect<void, unknown>;

  countOpenTabs: Effect.Effect<number, unknown>;
  getActiveTargetId: Effect.Effect<ActiveTarget, unknown>;

  handleCommand: (
    msg: ExtensionCommandMessage,
  ) => Effect.Effect<unknown, unknown>;
}

export const TabRegistry = Context.GenericTag<TabRegistry>("vibe/TabRegistry");

export const TabRegistryLive = Layer.effect(
  TabRegistry,
  Effect.gen(function* () {
    const connection = yield* Connection;

    // Only track attached tabs: tabId -> targetId
    const tabsRef = yield* Ref.make<ReadonlyMap<number, string>>(new Map());

    const setTargetId = (tabId: number, targetId: string) =>
      Ref.update(tabsRef, (tabs) => {
        const next = new Map(tabs);
        next.set(tabId, targetId);
        return next;
      });

    const deleteTab = (tabId: number) =>
      Ref.update(tabsRef, (tabs) => {
        const next = new Map(tabs);
        next.delete(tabId);
        return next;
      });

    const attach: TabRegistry["attach"] = (tabId) =>
      Effect.gen(function* () {
        const debuggee = { tabId };
        yield* Effect.tryPromise(() => chrome.debugger.attach(debuggee, "1.3"));

        const result = (yield* Effect.tryPromise(() =>
          chrome.debugger.sendCommand(debuggee, "Target.getTargetInfo"),
        )) as { targetInfo: TargetInfo };

        const targetInfo = result.targetInfo;
        yield* setTargetId(tabId, targetInfo.targetId);

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

    const countOpenTabs: TabRegistry["countOpenTabs"] = Effect.tryPromise(
      async () => {
        const tabs = await chrome.tabs.query({});
        return tabs.length;
      },
    );

    const getActiveTargetId: TabRegistry["getActiveTargetId"] = Effect.gen(
      function* () {
        const activeTabs = yield* Effect.tryPromise(() =>
          chrome.tabs.query({ active: true, lastFocusedWindow: true }),
        );

        const activeTab = activeTabs[0];
        const tabId = activeTab?.id;
        if (typeof tabId !== "number") {
          throw new Error("No active tab found");
        }

        const existingTargetId = yield* Ref.get(tabsRef).pipe(
          Effect.map((tabs) => tabs.get(tabId)),
        );

        if (existingTargetId) {
          return { tabId, targetId: existingTargetId };
        }

        const { targetInfo } = yield* attach(tabId);
        return { tabId, targetId: targetInfo.targetId };
      },
    );

    const detach: TabRegistry["detach"] = (tabId, shouldDetachDebugger) =>
      Effect.gen(function* () {
        const tabs = yield* Ref.get(tabsRef);
        const targetId = tabs.get(tabId);
        if (!targetId) return;

        yield* connection.send({
          method: "forwardCDPEvent",
          params: {
            method: "Target.detachedFromTarget",
            targetId,
            params: { targetId },
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
        const targetId = tabs.get(tabId);
        if (!targetId) return;

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

    const handleCommand: TabRegistry["handleCommand"] = (msg) =>
      Effect.gen(function* () {
        if (msg.method !== "tab") return undefined;

        switch (msg.params.method) {
          case "countTabs":
          case "tab.countTabs": {
            return yield* countOpenTabs;
          }

          case "getActiveTargetId":
          case "tab.getActiveTargetId": {
            const result = yield* getActiveTargetId;
            return result.targetId;
          }

          case "getActiveTarget":
          case "tab.getActiveTarget": {
            return yield* getActiveTargetId;
          }

          default: {
            throw new Error(`Unknown tab method: ${msg.params.method}`);
          }
        }
      });

    return {
      getTargetId: (tabId) =>
        Ref.get(tabsRef).pipe(Effect.map((tabs) => tabs.get(tabId))),
      has: (tabId) =>
        Ref.get(tabsRef).pipe(Effect.map((tabs) => tabs.has(tabId))),
      attach,
      detach,
      handleDebuggerDetach,
      detachAll,

      countOpenTabs,
      getActiveTargetId,
      handleCommand,
    } satisfies TabRegistry;
  }),
);
