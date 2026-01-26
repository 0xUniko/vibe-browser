/**
 * CDP Router (Effect service) - Routes CDP commands to the correct tab.
 */

import { Context, Effect, Layer, Ref } from "effect";
import type { ExtensionCommandMessage } from "../utils/types";
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

    const resolveTabIdFromTargetId = (targetId: string) =>
      listChromeTargets.pipe(
        Effect.map(
          (targets) =>
            targets.find((t) => t.id === targetId)?.tabId as number | undefined,
        ),
      );

    const handleCommand: CDPRouter["handleCommand"] = (msg) =>
      Effect.gen(function* () {
        // if (msg.method !== "forwardCDPCommand") return undefined;

        const targetId = msg.params.targetId;
        const debuggee: chrome.debugger.DebuggerSession | undefined = targetId
          ? { targetId }
          : undefined;

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
            const params = msg.params.params;
            const tabId = (params?.tabId as number | undefined) ?? undefined;

            if (typeof tabId === "number") {
              const { targetInfo } = yield* tabs.attach(tabId);
              return { targetId: targetInfo.targetId };
            }

            if (!targetId) {
              throw new Error(
                "VibeBrowser.attachTab requires msg.params.targetId (string) or params.tabId (number)",
              );
            }

            const maybeTabId = yield* resolveTabIdFromTargetId(targetId);
            if (typeof maybeTabId === "number") {
              const { targetInfo } = yield* tabs.attach(maybeTabId);
              return { targetId: targetInfo.targetId };
            }

            yield* logger.debug(
              "Attaching debugger to non-tab target:",
              targetId,
            );
            yield* Effect.tryPromise(() =>
              chrome.debugger.attach({ targetId }, "1.3"),
            );
            return { targetId };
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
            if (!targetId) {
              throw new Error(
                "Target.getTargetInfo requires msg.params.targetId",
              );
            }

            const targets = yield* listChromeTargets;
            const found = targets.find((t) => t.id === targetId);
            if (!found) {
              throw new Error(`Target not found: ${targetId}`);
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
            if (!targetId) {
              throw new Error(
                "Target.attachToTarget requires msg.params.targetId",
              );
            }

            const maybeTabId = yield* resolveTabIdFromTargetId(targetId);
            if (typeof maybeTabId === "number") {
              const { targetInfo } = yield* tabs.attach(maybeTabId);
              return { targetId: targetInfo.targetId };
            }

            yield* logger.debug(
              "Attaching debugger to non-tab target:",
              targetId,
            );
            yield* Effect.tryPromise(() =>
              chrome.debugger.attach({ targetId }, "1.3"),
            );
            return { targetId };
          }

          case "Runtime.enable": {
            if (!debuggee) {
              throw new Error(
                `No debuggee found for Runtime.enable (targetId: ${targetId})`,
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
            if (!targetId) {
              throw new Error("Target.closeTarget requires targetId");
            }
            const tabId = yield* resolveTabIdFromTargetId(targetId);
            if (!tabId) return { success: false };
            yield* Effect.tryPromise(() => chrome.tabs.remove(tabId));
            return { success: true };
          }

          case "Target.activateTarget": {
            if (!targetId) {
              throw new Error("Target.activateTarget requires targetId");
            }
            const tabId = yield* resolveTabIdFromTargetId(targetId);
            if (!tabId) return {};
            yield* Effect.tryPromise(() =>
              chrome.tabs.update(tabId, { active: true }),
            );
            return {};
          }
        }

        if (!debuggee) {
          throw new Error(
            `No targetId found for method ${msg.params.method} (expected msg.params.targetId)`,
          );
        }

        yield* logger.debug(
          "CDP command:",
          msg.params.method,
          "for targetId:",
          targetId,
        );

        return yield* Effect.tryPromise(() =>
          chrome.debugger.sendCommand(
            debuggee,
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
        const effectiveTargetId = source.targetId ?? tab?.targetId;
        if (!effectiveTargetId) return;

        yield* logger.debug(
          "Forwarding CDP event:",
          method,
          "from targetId:",
          effectiveTargetId,
        );

        yield* connection.send({
          method: "forwardCDPEvent",
          params: {
            targetId: effectiveTargetId,
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
