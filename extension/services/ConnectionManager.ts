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
import {
  createExtensionErrorInfo,
  errorToMessage,
  isExtensionCommandMessage,
  type ExtensionCommandMessage,
  type ExtensionErrorInfo,
} from "./RelayProtocol";
import { StateStore } from "./StateManager";

const RECONNECT_INTERVAL_MS = 3000;

const getRelayUrl = (port: number): string =>
  `ws://127.0.0.1:${String(port)}/extension`;

export type ConnectionEvent =
  | { _tag: "Connected" }
  | { _tag: "Disconnected"; reason?: string };

export interface Connection {
  send: (message: unknown) => Effect.Effect<void, ExtensionErrorInfo>;
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
    const state = yield* StateStore;
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

    const rawSend = (
      ws: WebSocket,
      message: unknown,
    ): ReturnType<typeof createExtensionErrorInfo> | undefined => {
      try {
        ws.send(JSON.stringify(message));
        return undefined;
      } catch {
        return createExtensionErrorInfo(
          "WS_SEND_FAILED",
          "Failed to send message to relay",
          {
            details: { readyState: ws.readyState },
          },
        );
      }
    };

    const send: Connection["send"] = (message) =>
      Effect.gen(function* () {
        const ws = yield* Ref.get(wsRef);
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          return yield* Effect.fail(
            createExtensionErrorInfo(
              "RELAY_NOT_CONNECTED",
              "Relay connection is not open",
            ),
          );
        }

        const sendError = rawSend(ws, message);
        if (sendError) {
          return yield* Effect.fail(sendError);
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
    });

    const tryConnectOnce = Effect.gen(function* () {
      const already = yield* isConnected;
      if (already) return;

      const currentState = yield* state.get;
      const relayUrl = getRelayUrl(currentState.port);

      const socket = yield* Effect.async<WebSocket, ExtensionErrorInfo>(
        (resume) => {
          const ws = new WebSocket(relayUrl);

          const timeoutId = setTimeout(() => {
            try {
              ws.close();
            } catch {
              // ignore
            }
            resume(
              Effect.fail(
                createExtensionErrorInfo(
                  "RELAY_CONNECT_TIMEOUT",
                  `Timed out connecting to relay at ${relayUrl}`,
                  {
                    details: { relayUrl, timeoutMs: 5000 },
                  },
                ),
              ),
            );
          }, 5000);

          ws.onopen = () => {
            clearTimeout(timeoutId);
            resume(Effect.succeed(ws));
          };

          ws.onerror = () => {
            clearTimeout(timeoutId);
            resume(
              Effect.fail(
                createExtensionErrorInfo(
                  "RELAY_CONNECT_FAILED",
                  `WebSocket connection failed for ${relayUrl}`,
                  {
                    details: { relayUrl },
                  },
                ),
              ),
            );
          };

          ws.onclose = (event) => {
            clearTimeout(timeoutId);
            resume(
              Effect.fail(
                createExtensionErrorInfo(
                  "RELAY_CONNECT_CLOSED",
                  `WebSocket closed while connecting to ${relayUrl}`,
                  {
                    details: {
                      relayUrl,
                      closeCode: event.code,
                      closeReason: event.reason || "",
                    },
                  },
                ),
              ),
            );
          };
        },
      );

      // Install handlers after open
      socket.onmessage = (event: MessageEvent) => {
        try {
          const parsed = JSON.parse(event.data) as unknown;
          if (isExtensionCommandMessage(parsed)) {
            void Effect.runPromise(Queue.offer(messagesQ, parsed));
          }
        } catch (error) {
          rawSend(socket, {
            method: "log",
            params: {
              level: "error",
              args: [
                `Received invalid JSON from relay: ${errorToMessage(error)}`,
              ],
            },
          });
        }
      };

      socket.onclose = (event: CloseEvent) => {
        void Effect.runPromise(
          Effect.gen(function* () {
            yield* Ref.set(wsRef, null);
            yield* Queue.offer(eventsQ, {
              _tag: "Disconnected",
              reason: event.reason || String(event.code),
            });
          }),
        );
      };

      yield* Ref.set(wsRef, socket);
      yield* Queue.offer(eventsQ, { _tag: "Connected" });
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
        yield* tryConnectOnce.pipe(
          Effect.catchAll((error) =>
            Queue.offer(eventsQ, {
              _tag: "Disconnected",
              reason: errorToMessage(error),
            }),
          ),
        );
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
      return connected;
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
