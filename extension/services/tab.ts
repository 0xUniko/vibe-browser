/**
 * Tab registry (Effect service) - Manages tab state and debugger attachment.
 */

import { Context, Effect, Layer, Ref } from "effect";
import { Connection } from "./ConnectionManager";
import type { ExtensionCommandMessage } from "./RelayProtocol";

const errorToMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

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
        yield* Effect.tryPromise({
          try: () => chrome.debugger.attach(debuggee, "1.3"),
          catch: (e) =>
            new Error(
              `Failed to attach debugger to tab ${tabId}: ${errorToMessage(e)}`,
            ),
        });

        const result = (yield* Effect.tryPromise({
          try: () =>
            chrome.debugger.sendCommand(debuggee, "Target.getTargetInfo"),
          catch: (e) =>
            new Error(
              `Failed to get TargetInfo for tab ${tabId}: ${errorToMessage(e)}`,
            ),
        })) as { targetInfo: TargetInfo };

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

    const createAttachableTab = (url: string) =>
      Effect.tryPromise({
        try: () => chrome.tabs.create({ url, active: true }),
        catch: (e) =>
          new Error(`Failed to create tab for ${url}: ${errorToMessage(e)}`),
      }).pipe(
        Effect.flatMap((tab) => {
          const tabId = tab.id;
          if (typeof tabId !== "number") {
            return Effect.fail(
              new Error("chrome.tabs.create returned no tab id"),
            );
          }

          return Effect.async<void, Error>((resume) => {
            const timeoutId = setTimeout(() => {
              chrome.tabs.onUpdated.removeListener(onUpdated);
              resume(
                Effect.fail(
                  new Error(`Timeout waiting for tab ${tabId} to load`),
                ),
              );
            }, 10_000);

            const onUpdated = (
              updatedTabId: number,
              info: chrome.tabs.OnUpdatedInfo,
            ) => {
              if (updatedTabId !== tabId) return;
              if (info.status !== "complete") return;

              clearTimeout(timeoutId);
              chrome.tabs.onUpdated.removeListener(onUpdated);
              resume(Effect.succeed(void 0));
            };

            chrome.tabs.onUpdated.addListener(onUpdated);

            return Effect.sync(() => {
              clearTimeout(timeoutId);
              chrome.tabs.onUpdated.removeListener(onUpdated);
            });
          }).pipe(Effect.as(tabId));
        }),
      );

    const countOpenTabs: TabRegistry["countOpenTabs"] = Effect.tryPromise(
      async () => {
        const tabs = await chrome.tabs.query({});
        return tabs.length;
      },
    );

    const getActiveTargetId: TabRegistry["getActiveTargetId"] = Effect.gen(
      function* () {
        const activeTabs = yield* Effect.tryPromise({
          try: () =>
            chrome.tabs.query({ active: true, lastFocusedWindow: true }),
          catch: (e) =>
            new Error(`Failed to query active tab: ${errorToMessage(e)}`),
        });

        const activeTab = activeTabs[0];
        const activeTabId = activeTab?.id;
        if (typeof activeTabId !== "number") {
          throw new Error("No active tab found");
        }

        const existingTargetId = yield* Ref.get(tabsRef).pipe(
          Effect.map((tabs) => tabs.get(activeTabId)),
        );

        if (existingTargetId) {
          return { tabId: activeTabId, targetId: existingTargetId };
        }

        // Attempt attach to the current active tab. This can fail on restricted pages
        // like chrome://newtab or the Chrome Web Store.
        const attached = yield* attach(activeTabId).pipe(
          Effect.map(({ targetInfo }) => ({
            tabId: activeTabId,
            targetId: targetInfo.targetId,
          })),
          Effect.catchAll(() =>
            Effect.gen(function* () {
              // Fallback: open an attachable https page and attach there.
              const fallbackTabId = yield* createAttachableTab(
                "https://example.com",
              );
              const { targetInfo } = yield* attach(fallbackTabId);
              return { tabId: fallbackTabId, targetId: targetInfo.targetId };
            }),
          ),
        );

        return attached;
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
