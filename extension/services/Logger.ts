import { Context, Effect, Layer, Option, Ref } from "effect";

export type LogLevel = "log" | "debug" | "error";

export interface Logger {
  log: (...args: ReadonlyArray<unknown>) => Effect.Effect<void>;
  debug: (...args: ReadonlyArray<unknown>) => Effect.Effect<void>;
  error: (...args: ReadonlyArray<unknown>) => Effect.Effect<void>;
  setRelaySender: (send: (message: unknown) => void) => Effect.Effect<void>;
  clearRelaySender: Effect.Effect<void>;
}

export const Logger = Context.GenericTag<Logger>("vibe/Logger");

function formatArgs(args: ReadonlyArray<unknown>): Array<string> {
  return args.map((arg) => {
    if (arg === undefined) return "undefined";
    if (arg === null) return "null";
    if (typeof arg === "object") {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  });
}

function relayLog(level: LogLevel, args: ReadonlyArray<unknown>): unknown {
  return {
    method: "log",
    params: {
      level,
      args: formatArgs(args),
    },
  };
}

export const LoggerLive = Layer.effect(
  Logger,
  Effect.gen(function* () {
    const relaySenderRef = yield* Ref.make<
      Option.Option<(message: unknown) => void>
    >(Option.none());

    const sendToRelay = (level: LogLevel, args: ReadonlyArray<unknown>) =>
      Effect.gen(function* () {
        const senderOpt = yield* Ref.get(relaySenderRef);
        if (Option.isSome(senderOpt)) {
          try {
            senderOpt.value(relayLog(level, args));
          } catch {
            // ignore
          }
        }
      });

    const logImpl =
      (level: LogLevel, consoleFn: (...args: ReadonlyArray<unknown>) => void) =>
      (...args: ReadonlyArray<unknown>) =>
        Effect.sync(() => {
          consoleFn("[vibe-browser]", ...args);
        }).pipe(Effect.zipRight(sendToRelay(level, args)));

    return {
      log: logImpl("log", console.log),
      debug: logImpl("debug", console.debug),
      error: logImpl("error", console.error),
      setRelaySender: (send) => Ref.set(relaySenderRef, Option.some(send)),
      clearRelaySender: Ref.set(relaySenderRef, Option.none()),
    } satisfies Logger;
  }),
);
