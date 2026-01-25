/**
 * Tab registry (Effect service) - Manages tab state and debugger attachment.
 */

import { Context, Effect, Layer, Ref } from "effect";
import type { TabInfo, TargetInfo } from "../utils/types";
import { Connection } from "./ConnectionManager";
import { Logger } from "./Logger";

export interface TabRegistry {
  get: (tabId: number) => Effect.Effect<TabInfo | undefined, unknown>;
  has: (tabId: number) => Effect.Effect<boolean, unknown>;
  set: (tabId: number, info: TabInfo) => Effect.Effect<void, unknown>;
  getBySessionId: (
    sessionId: string,
  ) => Effect.Effect<{ tabId: number; tab: TabInfo } | undefined, unknown>;
  getByTargetId: (
    targetId: string,
  ) => Effect.Effect<{ tabId: number; tab: TabInfo } | undefined, unknown>;
  getParentTabId: (
    sessionId: string,
  ) => Effect.Effect<number | undefined, unknown>;
  trackChildSession: (
    sessionId: string,
    parentTabId: number,
  ) => Effect.Effect<void, unknown>;
  untrackChildSession: (sessionId: string) => Effect.Effect<void, unknown>;
  attach: (
    tabId: number,
  ) => Effect.Effect<{ targetInfo: TargetInfo; sessionId: string }, unknown>;
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
    const logger = yield* Logger;
    const connection = yield* Connection;

    const tabsRef = yield* Ref.make<ReadonlyMap<number, TabInfo>>(new Map());
    const childSessionsRef = yield* Ref.make<ReadonlyMap<string, number>>(
      new Map(),
    );
    const nextSessionIdRef = yield* Ref.make(1);

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

    const deleteChildSessionsForTab = (tabId: number) =>
      Ref.update(childSessionsRef, (child) => {
        const next = new Map(child);
        for (const [childSessionId, parentTabId] of next) {
          if (parentTabId === tabId) next.delete(childSessionId);
        }
        return next;
      });

    const getBySessionId: TabRegistry["getBySessionId"] = (sessionId) =>
      Ref.get(tabsRef).pipe(
        Effect.map((tabs) => {
          for (const [tabId, tab] of tabs) {
            if (tab.sessionId === sessionId) return { tabId, tab };
          }
          return undefined;
        }),
      );

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
        yield* logger.debug("Attaching debugger to tab:", tabId);

        yield* Effect.tryPromise(() => chrome.debugger.attach(debuggee, "1.3"));

        const result = (yield* Effect.tryPromise(() =>
          chrome.debugger.sendCommand(debuggee, "Target.getTargetInfo"),
        )) as { targetInfo: TargetInfo };

        const targetInfo = result.targetInfo;
        const nextSessionId = yield* Ref.get(nextSessionIdRef);
        yield* Ref.set(nextSessionIdRef, nextSessionId + 1);

        const sessionId = `pw-tab-${nextSessionId}`;

        yield* setTab(tabId, {
          sessionId,
          targetId: targetInfo.targetId,
          state: "connected",
        });

        yield* connection.send({
          method: "forwardCDPEvent",
          params: {
            method: "Target.attachedToTarget",
            params: {
              sessionId,
              targetInfo: { ...targetInfo, attached: true },
              waitingForDebugger: false,
            },
          },
        });

        yield* logger.log(
          "Tab attached:",
          tabId,
          "sessionId:",
          sessionId,
          "url:",
          targetInfo.url,
        );
        return { targetInfo, sessionId };
      });

    const detach: TabRegistry["detach"] = (tabId, shouldDetachDebugger) =>
      Effect.gen(function* () {
        const tabs = yield* Ref.get(tabsRef);
        const tab = tabs.get(tabId);
        if (!tab) return;

        yield* logger.debug("Detaching tab:", tabId);

        yield* connection.send({
          method: "forwardCDPEvent",
          params: {
            method: "Target.detachedFromTarget",
            params: { sessionId: tab.sessionId, targetId: tab.targetId },
          },
        });

        yield* deleteTab(tabId);
        yield* deleteChildSessionsForTab(tabId);

        if (shouldDetachDebugger) {
          yield* Effect.tryPromise(() =>
            chrome.debugger.detach({ tabId }),
          ).pipe(
            Effect.catchAll((err) =>
              logger.debug("Error detaching debugger:", err),
            ),
          );
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
            params: { sessionId: tab.sessionId, targetId: tab.targetId },
          },
        });

        yield* deleteChildSessionsForTab(tabId);
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
      yield* Ref.set(childSessionsRef, new Map());
    });

    return {
      get: (tabId) =>
        Ref.get(tabsRef).pipe(Effect.map((tabs) => tabs.get(tabId))),
      has: (tabId) =>
        Ref.get(tabsRef).pipe(Effect.map((tabs) => tabs.has(tabId))),
      set: setTab,
      getBySessionId,
      getByTargetId,
      getParentTabId: (sessionId) =>
        Ref.get(childSessionsRef).pipe(Effect.map((m) => m.get(sessionId))),
      trackChildSession: (sessionId, parentTabId) =>
        logger
          .debug("Child target attached:", sessionId, "for tab:", parentTabId)
          .pipe(
            Effect.zipRight(
              Ref.update(childSessionsRef, (m) => {
                const next = new Map(m);
                next.set(sessionId, parentTabId);
                return next;
              }),
            ),
          ),
      untrackChildSession: (sessionId) =>
        logger.debug("Child target detached:", sessionId).pipe(
          Effect.zipRight(
            Ref.update(childSessionsRef, (m) => {
              const next = new Map(m);
              next.delete(sessionId);
              return next;
            }),
          ),
        ),
      attach,
      detach,
      handleDebuggerDetach,
      detachAll,
    } satisfies TabRegistry;
  }),
);
