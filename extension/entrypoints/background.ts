/**
 * vibe-browser Chrome Extension Background Script
 *
 * Effect-powered wiring (no classes / no manager-singleton style).
 */

import { Effect, Layer, ManagedRuntime, Stream } from "effect";
import { CDPRouter, CDPRouterLive } from "../services/CDPRouter";
import { Connection, ConnectionLive } from "../services/ConnectionManager";
import { Logger, LoggerLive } from "../services/Logger";
import { StateStore, StateStoreLive } from "../services/StateManager";
import { TabRegistry, TabRegistryLive } from "../services/TabManager";
import type {
  ExtensionResponseMessage,
  PopupMessage,
  StateResponse,
} from "../utils/types";

export default defineBackground(() => {
  const loggerLayer = LoggerLive;
  const stateLayer = StateStoreLive;
  const connectionLayer = ConnectionLive.pipe(Layer.provide(loggerLayer));
  const tabLayer = TabRegistryLive.pipe(
    Layer.provide(loggerLayer),
    Layer.provide(connectionLayer),
  );
  const routerLayer = CDPRouterLive.pipe(
    Layer.provide(loggerLayer),
    Layer.provide(connectionLayer),
    Layer.provide(tabLayer),
  );

  const MainLayer = Layer.mergeAll(
    loggerLayer,
    stateLayer,
    connectionLayer,
    tabLayer,
    routerLayer,
  );

  const runtime = ManagedRuntime.make(MainLayer);

  type AppEnv = Logger | Connection | TabRegistry | CDPRouter | StateStore;

  const runFork = <A, E, R>(eff: Effect.Effect<A, E, R>) => {
    runtime.runFork(eff as Effect.Effect<A, E, AppEnv>);
  };

  const updateBadge = (isActive: boolean) =>
    Effect.tryPromise(async () => {
      chrome.action.setBadgeText({ text: isActive ? "ON" : "" });
      chrome.action.setBadgeBackgroundColor({ color: "#4CAF50" });
    });

  const handleStateChange = (isActive: boolean) =>
    Effect.gen(function* () {
      const state = yield* StateStore;
      const connection = yield* Connection;
      yield* state.set({ isActive });
      if (isActive) {
        yield* connection.startMaintaining;
      } else {
        yield* connection.disconnect;
      }
      yield* updateBadge(isActive);
    });

  const onDebuggerEvent = (
    source: chrome.debugger.DebuggerSession,
    method: string,
    params: unknown,
  ) => {
    runFork(
      Effect.gen(function* () {
        const router = yield* CDPRouter;
        yield* router.handleDebuggerEvent(source, method, params);
      }),
    );
  };

  const onDebuggerDetach = (
    source: chrome.debugger.Debuggee,
    reason: `${chrome.debugger.DetachReason}`,
  ) => {
    const tabId = source.tabId;
    if (!tabId) return;
    runFork(
      Effect.gen(function* () {
        const logger = yield* Logger;
        const tabs = yield* TabRegistry;
        yield* logger.debug(`Debugger detached for tab ${tabId}: ${reason}`);
        yield* tabs.handleDebuggerDetach(tabId);
      }),
    );
  };

  // Handle messages from popup
  chrome.runtime.onMessage.addListener(
    (
      message: PopupMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response: StateResponse) => void,
    ) => {
      if (message.type === "getState") {
        runtime
          .runPromise(
            Effect.gen(function* () {
              const state = yield* StateStore;
              const connection = yield* Connection;
              const current = yield* state.get;
              const isConnected = yield* connection.checkConnection;
              return {
                isActive: current.isActive,
                isConnected,
              } satisfies StateResponse;
            }),
          )
          .then(sendResponse)
          .catch(() => sendResponse({ isActive: false, isConnected: false }));
        return true; // Async response
      }

      if (message.type === "setState") {
        runtime
          .runPromise(
            Effect.gen(function* () {
              yield* handleStateChange(message.isActive);
              const state = yield* StateStore;
              const connection = yield* Connection;
              const current = yield* state.get;
              const isConnected = yield* connection.checkConnection;
              return {
                isActive: current.isActive,
                isConnected,
              } satisfies StateResponse;
            }),
          )
          .then(sendResponse)
          .catch(() => sendResponse({ isActive: false, isConnected: false }));
        return true; // Async response
      }

      return false;
    },
  );

  // Set up event listeners

  chrome.tabs.onRemoved.addListener((tabId) => {
    runFork(
      Effect.gen(function* () {
        const tabs = yield* TabRegistry;
        const logger = yield* Logger;
        const tracked = yield* tabs.has(tabId);
        if (!tracked) return;
        yield* logger.debug("Tab closed:", tabId);
        yield* tabs.detach(tabId, false);
      }),
    );
  });

  // Register debugger event listeners
  chrome.debugger.onEvent.addListener(onDebuggerEvent);
  chrome.debugger.onDetach.addListener(onDebuggerDetach);

  // Stream: process inbound commands from relay
  runFork(
    Effect.gen(function* () {
      const connection = yield* Connection;
      const router = yield* CDPRouter;
      const logger = yield* Logger;

      const processEvents = Stream.runForEach(connection.events, (event) =>
        event._tag === "Disconnected"
          ? Effect.gen(function* () {
              const tabs = yield* TabRegistry;
              yield* tabs.detachAll;
            })
          : Effect.void,
      );

      const processMessages = Stream.runForEach(
        connection.messages,
        (message) =>
          Effect.gen(function* () {
            const response: ExtensionResponseMessage = { id: message.id };
            try {
              response.result = yield* router.handleCommand(message);
            } catch (error) {
              yield* logger.debug("Error handling command:", error);
              response.error = (error as Error).message;
            }
            yield* connection.send(response);
          }),
      );

      yield* Effect.forkDaemon(processEvents);
      yield* Effect.forkDaemon(processMessages);
    }),
  );

  // Reset any stale debugger connections on startup
  runFork(
    Effect.gen(function* () {
      const logger = yield* Logger;
      const targets = yield* Effect.tryPromise(() =>
        chrome.debugger.getTargets(),
      );
      const attached = targets.filter((t) => t.tabId && t.attached);
      if (attached.length > 0) {
        yield* logger.log(
          `Detaching ${attached.length} stale debugger connections`,
        );
        for (const target of attached) {
          yield* Effect.tryPromise(() =>
            chrome.debugger.detach({ tabId: target.tabId }),
          ).pipe(Effect.catchAll(() => Effect.void));
        }
      }
    }),
  );

  runFork(
    Effect.gen(function* () {
      const logger = yield* Logger;
      yield* logger.log("Extension initialized");

      const state = yield* StateStore;
      const connection = yield* Connection;
      const current = yield* state.get;
      yield* updateBadge(current.isActive);
      if (current.isActive) {
        yield* connection.startMaintaining;
      }
    }),
  );
});
