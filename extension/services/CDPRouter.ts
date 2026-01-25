/**
 * CDP Router (Effect service) - Routes CDP commands to the correct tab.
 */

import { Context, Effect, Layer, Ref } from "effect";
import type { ExtensionCommandMessage, TabInfo } from "../utils/types";
import { Connection } from "./ConnectionManager";
import { Logger } from "./Logger";
import { TabRegistry } from "./TabManager";

export interface CDPRouter {
  handleCommand: (
    msg: ExtensionCommandMessage,
  ) => Effect.Effect<unknown, unknown>;
  handleDebuggerEvent: (
    source: chrome.debugger.DebuggerSession,
    method: string,
    params: unknown,
  ) => Effect.Effect<void, unknown>;
}

export const CDPRouter = Context.GenericTag<CDPRouter>("vibe/CDPRouter");

export const CDPRouterLive = Layer.effect(
  CDPRouter,
  Effect.gen(function* () {
    const logger = yield* Logger;
    const tabs = yield* TabRegistry;
    const connection = yield* Connection;

    const groupIdRef = yield* Ref.make<number | null>(null);

    const listChromeTargets = Effect.tryPromise(() =>
      chrome.debugger.getTargets(),
    );

    const getOrCreateVibeBrowserGroup = (tabId: number) =>
      Effect.gen(function* () {
        const cached = yield* Ref.get(groupIdRef);
        if (cached !== null) {
          const ok = yield* Effect.tryPromise(() =>
            chrome.tabGroups.get(cached),
          ).pipe(
            Effect.as(true),
            Effect.catchAll(() => Effect.succeed(false)),
          );
          if (ok) {
            yield* Effect.tryPromise(() =>
              chrome.tabs.group({ tabIds: [tabId], groupId: cached }),
            );
            return cached;
          }
          yield* Ref.set(groupIdRef, null);
        }

        const groupId = yield* Effect.tryPromise(() =>
          chrome.tabs.group({ tabIds: [tabId] }),
        );
        yield* Effect.tryPromise(() =>
          chrome.tabGroups.update(groupId, {
            title: "Vibe Browser",
            color: "blue",
          }),
        );
        yield* Ref.set(groupIdRef, groupId);
        return groupId;
      });

    const handleCommand: CDPRouter["handleCommand"] = (msg) =>
      Effect.gen(function* () {
        if (msg.method !== "forwardCDPCommand") return undefined;

        let targetTabId: number | undefined;
        let targetTab: TabInfo | undefined;

        if (msg.params.sessionId) {
          const found = yield* tabs.getBySessionId(msg.params.sessionId);
          if (found) {
            targetTabId = found.tabId;
            targetTab = found.tab;
          }
        }

        if (!targetTab && msg.params.sessionId) {
          const parentTabId = yield* tabs.getParentTabId(msg.params.sessionId);
          if (parentTabId) {
            targetTabId = parentTabId;
            targetTab = yield* tabs.get(parentTabId);
            yield* logger.debug(
              "Found parent tab for child session:",
              msg.params.sessionId,
              "tabId:",
              parentTabId,
            );
          }
        }

        if (
          !targetTab &&
          msg.params.params &&
          typeof msg.params.params === "object" &&
          "targetId" in msg.params.params
        ) {
          const found = yield* tabs.getByTargetId(
            msg.params.params.targetId as string,
          );
          if (found) {
            targetTabId = found.tabId;
            targetTab = found.tab;
          }
        }

        const debuggee = targetTabId ? { tabId: targetTabId } : undefined;

        switch (msg.params.method) {
          case "VibeBrowser.listTabs": {
            const targets = yield* listChromeTargets;
            return {
              targets: targets
                .filter((t) => typeof t.id === "string")
                .map((t) => ({
                  targetId: t.id,
                  tabId: t.tabId,
                  type: t.type,
                  title: t.title,
                  url: t.url,
                  attached: t.attached,
                })),
            };
          }

          case "VibeBrowser.attachTab": {
            const tabId =
              (msg.params.params?.tabId as number | undefined) ?? undefined;
            if (!tabId || typeof tabId !== "number") {
              throw new Error(
                "VibeBrowser.attachTab requires params.tabId (number)",
              );
            }

            const existing = yield* tabs.get(tabId);
            if (existing?.sessionId) {
              return { sessionId: existing.sessionId };
            }

            const { sessionId } = yield* tabs.attach(tabId);
            return { sessionId };
          }

          case "Target.getTargets": {
            const targets = yield* listChromeTargets;
            return {
              targetInfos: targets
                .filter((t) => t.type && t.id)
                .map((t) => ({
                  targetId: t.id,
                  type: t.type,
                  title: t.title,
                  url: t.url,
                  attached: Boolean(t.attached),
                })),
            };
          }

          case "Target.getTargetInfo": {
            const requestedTargetId = msg.params.params?.targetId as
              | string
              | undefined;
            if (!requestedTargetId) {
              throw new Error("Target.getTargetInfo requires params.targetId");
            }

            const targets = yield* listChromeTargets;
            const found = targets.find((t) => t.id === requestedTargetId);
            if (!found) {
              throw new Error(`Target not found: ${requestedTargetId}`);
            }

            return {
              targetInfo: {
                targetId: found.id,
                type: found.type,
                title: found.title,
                url: found.url,
                attached: Boolean(found.attached),
              },
            };
          }

          case "Target.attachToTarget": {
            const targetId = msg.params.params?.targetId as string | undefined;
            if (!targetId) {
              throw new Error("Target.attachToTarget requires params.targetId");
            }

            const tracked = yield* tabs.getByTargetId(targetId);
            if (tracked?.tab.sessionId) {
              return { sessionId: tracked.tab.sessionId };
            }

            const targets = yield* listChromeTargets;
            const found = targets.find((t) => t.id === targetId);
            const tabId = found?.tabId;
            if (!tabId || typeof tabId !== "number") {
              throw new Error(
                `Target ${targetId} is not a tab target (no tabId)`,
              );
            }

            const { sessionId } = yield* tabs.attach(tabId);
            return { sessionId };
          }

          case "Runtime.enable": {
            if (!debuggee) {
              throw new Error(
                `No debuggee found for Runtime.enable (sessionId: ${msg.params.sessionId})`,
              );
            }
            yield* Effect.tryPromise(() =>
              chrome.debugger.sendCommand(debuggee, "Runtime.disable"),
            ).pipe(Effect.catchAll(() => Effect.void));
            yield* Effect.tryPromise(
              () => new Promise((r) => setTimeout(r, 200)),
            ).pipe(Effect.catchAll(() => Effect.void));
            return yield* Effect.tryPromise(() =>
              chrome.debugger.sendCommand(
                debuggee,
                "Runtime.enable",
                msg.params.params,
              ),
            );
          }

          case "Target.createTarget": {
            const url = (msg.params.params?.url as string) || "about:blank";
            yield* logger.debug("Creating new tab with URL:", url);
            const tab = yield* Effect.tryPromise(() =>
              chrome.tabs.create({ url, active: false }),
            );
            if (!tab.id) throw new Error("Failed to create tab");

            yield* getOrCreateVibeBrowserGroup(tab.id);
            yield* Effect.tryPromise(
              () => new Promise((r) => setTimeout(r, 100)),
            );
            const { targetInfo } = yield* tabs.attach(tab.id);
            return { targetId: targetInfo.targetId };
          }

          case "Target.closeTarget": {
            if (!targetTabId) {
              yield* logger.log(
                `Target not found: ${msg.params.params?.targetId}`,
              );
              return { success: false };
            }
            yield* Effect.tryPromise(() => chrome.tabs.remove(targetTabId));
            return { success: true };
          }

          case "Target.activateTarget": {
            if (!targetTabId) {
              yield* logger.log(
                `Target not found for activation: ${msg.params.params?.targetId}`,
              );
              return {};
            }
            yield* Effect.tryPromise(() =>
              chrome.tabs.update(targetTabId, { active: true }),
            );
            return {};
          }
        }

        if (!debuggee || !targetTab) {
          throw new Error(
            `No tab found for method ${msg.params.method} sessionId: ${msg.params.sessionId}`,
          );
        }

        yield* logger.debug(
          "CDP command:",
          msg.params.method,
          "for tab:",
          targetTabId,
        );

        const debuggerSession: chrome.debugger.DebuggerSession = {
          ...debuggee,
          sessionId:
            msg.params.sessionId !== targetTab.sessionId
              ? msg.params.sessionId
              : undefined,
        };

        return yield* Effect.tryPromise(() =>
          chrome.debugger.sendCommand(
            debuggerSession,
            msg.params.method,
            msg.params.params,
          ),
        );
      });

    const handleDebuggerEvent: CDPRouter["handleDebuggerEvent"] = (
      source,
      method,
      params,
    ) =>
      Effect.gen(function* () {
        const tab = source.tabId ? yield* tabs.get(source.tabId) : undefined;
        if (!tab) return;

        yield* logger.debug(
          "Forwarding CDP event:",
          method,
          "from tab:",
          source.tabId,
        );

        if (
          method === "Target.attachedToTarget" &&
          params &&
          typeof params === "object" &&
          "sessionId" in params
        ) {
          const sessionId = (params as { sessionId: string }).sessionId;
          yield* tabs.trackChildSession(sessionId, source.tabId!);
        }

        if (
          method === "Target.detachedFromTarget" &&
          params &&
          typeof params === "object" &&
          "sessionId" in params
        ) {
          const sessionId = (params as { sessionId: string }).sessionId;
          yield* tabs.untrackChildSession(sessionId);
        }

        yield* connection.send({
          method: "forwardCDPEvent",
          params: {
            sessionId: source.sessionId || tab.sessionId,
            method,
            params,
          },
        });
      });

    return {
      handleCommand,
      handleDebuggerEvent,
    } satisfies CDPRouter;
  }),
);
