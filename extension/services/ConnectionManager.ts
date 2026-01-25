/**
 * Connection (Effect service) - Manages WebSocket connection to relay server.
 */

import {
  Context,
  Duration,
  Effect,
  Fiber,
  Layer,
  Queue,
  Ref,
  Stream,
} from "effect";
import type { ExtensionCommandMessage } from "../utils/types";
import { Logger } from "./Logger";

const RELAY_URL = "ws://localhost:9222/extension";
const RELAY_HTTP = "http://localhost:9222";
const RECONNECT_INTERVAL_MS = 3000;

export type ConnectionEvent =
  | { _tag: "Connected" }
  | { _tag: "Disconnected"; reason?: string };

export interface Connection {
  send: (message: unknown) => Effect.Effect<void>;
  startMaintaining: Effect.Effect<void>;
  disconnect: Effect.Effect<void>;
  isConnected: Effect.Effect<boolean>;
  checkConnection: Effect.Effect<boolean>;
  messages: Stream.Stream<ExtensionCommandMessage>;
  events: Stream.Stream<ConnectionEvent>;
}

export const Connection = Context.GenericTag<Connection>("vibe/Connection");

export const ConnectionLive = Layer.effect(
  Connection,
  Effect.gen(function* () {
    const logger = yield* Logger;

    const wsRef = yield* Ref.make<WebSocket | null>(null);
    const maintainRef = yield* Ref.make(false);
    const fiberRef = yield* Ref.make<Fiber.RuntimeFiber<void, never> | null>(
      null,
    );

    const messagesQ = yield* Queue.unbounded<ExtensionCommandMessage>();
    const eventsQ = yield* Queue.unbounded<ConnectionEvent>();

    const isConnected = Ref.get(wsRef).pipe(
      Effect.map((ws) => ws?.readyState === WebSocket.OPEN),
    );

    const rawSend = (ws: WebSocket, message: unknown): void => {
      try {
        ws.send(JSON.stringify(message));
      } catch {
        // ignore
      }
    };

    const send: Connection["send"] = (message) =>
      Effect.gen(function* () {
        const ws = yield* Ref.get(wsRef);
        if (ws && ws.readyState === WebSocket.OPEN) {
          rawSend(ws, message);
        }
      });

    const closeSocket = Effect.gen(function* () {
      const ws = yield* Ref.get(wsRef);
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
      yield* Ref.set(wsRef, null);
      yield* logger.clearRelaySender;
    });

    const checkServerReachable = Effect.tryPromise(async () => {
      const response = await fetch(RELAY_HTTP, {
        method: "HEAD",
        signal: AbortSignal.timeout(1000),
      });
      return response.ok;
    });

    const tryConnectOnce = Effect.gen(function* () {
      const already = yield* isConnected;
      if (already) return;

      const reachable = yield* checkServerReachable.pipe(
        Effect.catchAll(() => Effect.succeed(false)),
      );
      if (!reachable) return;

      yield* logger.debug("Connecting to relay server...");

      const socket = yield* Effect.async<WebSocket, Error>((resume) => {
        const ws = new WebSocket(RELAY_URL);

        const timeoutId = setTimeout(() => {
          try {
            ws.close();
          } catch {
            // ignore
          }
          resume(Effect.fail(new Error("Connection timeout")));
        }, 5000);

        ws.onopen = () => {
          clearTimeout(timeoutId);
          resume(Effect.succeed(ws));
        };

        ws.onerror = () => {
          clearTimeout(timeoutId);
          resume(Effect.fail(new Error("WebSocket connection failed")));
        };

        ws.onclose = (event) => {
          clearTimeout(timeoutId);
          resume(
            Effect.fail(
              new Error(`WebSocket closed: ${event.reason || event.code}`),
            ),
          );
        };
      });

      // Install handlers after open
      socket.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data) as ExtensionCommandMessage;
          void Effect.runPromise(Queue.offer(messagesQ, msg));
        } catch (error) {
          void Effect.runPromise(logger.debug("Error parsing message:", error));
          rawSend(socket, { error: { code: -32700, message: "Parse error" } });
        }
      };

      socket.onclose = (event: CloseEvent) => {
        void Effect.runPromise(
          Effect.gen(function* () {
            yield* logger.debug("Connection closed:", event.code, event.reason);
            yield* Ref.set(wsRef, null);
            yield* logger.clearRelaySender;
            yield* Queue.offer(eventsQ, {
              _tag: "Disconnected",
              reason: event.reason || String(event.code),
            });
          }),
        );
      };

      socket.onerror = (event: Event) => {
        void Effect.runPromise(logger.debug("WebSocket error:", event));
      };

      yield* Ref.set(wsRef, socket);
      yield* logger.setRelaySender((message) => rawSend(socket, message));
      yield* Queue.offer(eventsQ, { _tag: "Connected" });
      yield* logger.log("Connected to relay server");
    });

    const disconnect = Effect.gen(function* () {
      yield* Ref.set(maintainRef, false);
      const fiber = yield* Ref.get(fiberRef);
      if (fiber) {
        yield* Fiber.interrupt(fiber);
      }
      yield* Ref.set(fiberRef, null);
      yield* closeSocket;
      yield* Queue.offer(eventsQ, { _tag: "Disconnected", reason: "manual" });
    });

    const maintainLoop = Effect.gen(function* () {
      while (true) {
        const maintaining = yield* Ref.get(maintainRef);
        if (!maintaining) return;
        yield* tryConnectOnce.pipe(Effect.catchAll(() => Effect.void));
        yield* Effect.sleep(Duration.millis(RECONNECT_INTERVAL_MS));
      }
    });

    const startMaintaining = Effect.gen(function* () {
      yield* Ref.set(maintainRef, true);
      const existing = yield* Ref.get(fiberRef);
      if (existing) return;
      const fiber = yield* Effect.forkDaemon(maintainLoop);
      yield* Ref.set(fiberRef, fiber);
    });

    const checkConnection = Effect.gen(function* () {
      const connected = yield* isConnected;
      if (!connected) return false;

      const reachable = yield* checkServerReachable.pipe(
        Effect.catchAll(() => Effect.succeed(false)),
      );
      if (reachable) return true;

      // stale socket
      yield* closeSocket;
      yield* Queue.offer(eventsQ, { _tag: "Disconnected", reason: "stale" });
      return false;
    });

    return {
      send,
      startMaintaining,
      disconnect,
      isConnected,
      checkConnection,
      messages: Stream.fromQueue(messagesQ),
      events: Stream.fromQueue(eventsQ),
    } satisfies Connection;
  }),
);
