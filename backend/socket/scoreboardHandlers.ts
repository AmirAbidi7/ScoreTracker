import { Effect } from "effect";
import type { Server } from "socket.io";
import type { ScoreboardDTO } from "../dto/ScoreboardDTO";
import { parseIntent } from "../dto/ScoreboardIntent";
import { appServices } from "../utils/layers";
import { roomFor } from "../service/scoreboardIntentService";

export type ScoreboardAck =
  | { readonly ok: true; readonly scoreboard: ScoreboardDTO }
  | { readonly ok: false; readonly code: number; readonly message: string };

/**
 * One build of the layer, so the intent service and its serialising lock are the
 * same objects the REST routes use.
 */
const { intentService, socketService } = appServices();

/** Accepts either a bare string or a `{ code }` object. */
const readCode = (payload: unknown): string | null => {
  if (typeof payload === "string") return payload;
  if (typeof payload === "object" && payload !== null) {
    const code = (payload as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
};

/**
 * Reads `code` off any of the tagged errors in `errors.ts`. All of them are
 * `Data.TaggedError` with a `code` and a `message`, so this stays correct as
 * errors are added instead of enumerating a union that will drift.
 */
const statusOf = (error: unknown): number =>
  typeof error === "object" && error !== null && "code" in error
    ? Number((error as { code: unknown }).code)
    : 500;

const messageOf = (error: unknown): string =>
  typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message)
    : "Internal Server Error";

/**
 * Runs an Effect to completion and hands the outcome to the ack. Swallows
 * rejections on purpose: an unhandled rejection here would surface as an
 * `unhandledRejection` on the server and can take the whole process down over
 * one bad payload from one client.
 */
const settle = <A, E>(
  effect: Effect.Effect<A, E>,
  onSuccess: (value: A) => void,
  onFailure: (error: E) => void,
): void => {
  Effect.runPromise(
    effect.pipe(
      // `Effect.match` rather than `tap`/`catchAll`: both callbacks return
      // void, which is not an Effect, so a tap-based version does not typecheck.
      Effect.match({
        onSuccess: (value) => {
          onSuccess(value);
          return null;
        },
        onFailure: (error) => {
          onFailure(error);
          return null;
        },
      }),
    ),
  ).catch((fatal: unknown) => {
    console.error("[scoreboard] intent handler failed unexpectedly", fatal);
  });
};

export const registerScoreboardHandlers = (io: Server): void => {
  io.on("connection", (socket) => {
    socket.on("scoreboard:join", (payload: unknown) => {
      const code = readCode(payload);
      if (!code) return;
      void socket.join(roomFor(code));
    });

    socket.on("scoreboard:leave", (payload: unknown) => {
      const code = readCode(payload);
      if (!code) return;
      void socket.leave(roomFor(code));
    });

    socket.on("scoreboard:intent", (payload: unknown, ack?: (response: ScoreboardAck) => void) => {
      const respond = typeof ack === "function" ? ack : () => {};

      const code = readCode(payload);
      const intent = parseIntent(
        typeof payload === "object" && payload !== null && "intent" in payload
          ? (payload as { intent: unknown }).intent
          : undefined,
      );

      if (!code || !intent) {
        respond({ ok: false, code: 400, message: "malformed scoreboard:intent payload" });
        return;
      }

      settle(
        intentService.applyIntentToCode(code, intent),
        (scoreboard) => {
          // Broadcast to the room, then ack the sender. The sender receives
          // both, which is harmless: identical payloads, and the client drops
          // anything not strictly newer than what it already holds.
          //
          // A failed broadcast must not turn a successful intent into an
          // error for the sender: the ack below already carries the
          // authoritative board, so the sender is correct either way. Peers in
          // the room are not, and nothing here repairs them — the board is
          // persisted, so the next successful broadcast carries the state they
          // missed. Logged loudly rather than swallowed.
          Effect.runPromise(socketService.updateScoreboard(scoreboard)).catch((fatal: unknown) => {
            console.error(`[scoreboard] broadcast to ${roomFor(scoreboard.code)} failed`, fatal);
          });
          respond({ ok: true, scoreboard });
        },
        (error) => respond({ ok: false, code: statusOf(error), message: messageOf(error) }),
      );
    });
  });
};
