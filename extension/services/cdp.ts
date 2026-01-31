/**
 * CDP Router (Effect service) - Routes CDP commands to the correct tab.
 */

import { Context, Effect, Layer } from "effect";
import { Connection } from "./ConnectionManager";
import type { ExtensionCommandMessage } from "./RelayProtocol";
import { TabRegistry } from "./tab";

export interface CDP {
  handleCommand: (
    msg: ExtensionCommandMessage,
  ) => Effect.Effect<unknown, unknown>;
  handleDebuggerEvent: (
    source: chrome.debugger.DebuggerSession,
    method: string,
    params: unknown,
  ) => Effect.Effect<void, unknown>;
}

export const CDP = Context.GenericTag<CDP>("vibe/CDP");

export const CDPLive = Layer.effect(
  CDP,
  Effect.gen(function* () {
    const tabs = yield* TabRegistry;
    const connection = yield* Connection;

    const handleCommand: CDP["handleCommand"] = (msg) =>
      Effect.gen(function* () {
        if (msg.method !== "cdp") return undefined;

        const method = msg.params.method;

        // Target.getTargets - Chrome provides a dedicated API for this
        if (method === "Target.getTargets") {
          const targets = yield* Effect.tryPromise(() =>
            chrome.debugger.getTargets(),
          );
          return {
            targetInfos: targets.map((t) => ({
              targetId: t.id,
              type: t.type,
              title: t.title,
              url: t.url,
              attached: t.attached,
            })),
          };
        }

        const targetId = msg.params.targetId;
        if (!targetId) {
          throw new Error(`No targetId provided for method ${method}`);
        }

        const debuggee: chrome.debugger.DebuggerSession = { targetId };

        return yield* Effect.tryPromise(() =>
          chrome.debugger.sendCommand(debuggee, method, msg.params.params),
        );
      });

    const handleDebuggerEvent: CDP["handleDebuggerEvent"] = (
      source,
      method,
      params,
    ) =>
      Effect.gen(function* () {
        const tabTargetId = source.tabId
          ? yield* tabs.getTargetId(source.tabId)
          : undefined;
        const effectiveTargetId = source.targetId ?? tabTargetId;
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
    } satisfies CDP;
  }),
);
