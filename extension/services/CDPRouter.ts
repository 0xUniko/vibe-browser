/**
 * CDP Router (Effect service) - Routes CDP commands to the correct tab.
 */

import { Context, Effect, Layer } from "effect";
import { Connection } from "./ConnectionManager";
import type { ExtensionCommandMessage } from "./RelayProtocol";
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
    const tabs = yield* TabRegistry;
    const connection = yield* Connection;

    const handleCommand: CDPRouter["handleCommand"] = (msg) =>
      Effect.gen(function* () {
        if (msg.method !== "cdp") return undefined;

        const targetId = msg.params.targetId;
        const debuggee: chrome.debugger.DebuggerSession | undefined = targetId
          ? { targetId }
          : undefined;

        if (!debuggee) {
          throw new Error(
            `No targetId found for method ${msg.params.method} (expected msg.params.targetId)`,
          );
        }

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
