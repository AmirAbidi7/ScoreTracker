import { Effect } from "effect";
import type { Server } from "socket.io";
import type { ScoreboardDTO } from "../dto/ScoreboardDTO";
import { parseIntent } from "../dto/ScoreboardIntent";
import { verifySessionTokenLive, type VerifySessionToken } from "../utils/auth";
import { appServices } from "../utils/layers";
import { roomFor } from "../service/scoreboardIntentService";
import type { ScoreboardIntentServiceInterface } from "../service/scoreboardIntentService";
import type { ScoreboardSocketInterface } from "../service/scoreboardSocket";

export type ScoreboardAck =
  | { readonly ok: true; readonly scoreboard: ScoreboardDTO }
  | { readonly ok: false; readonly code: number; readonly message: string };

const { intentService, socketService } = appServices();

export type ScoreboardHandlerDeps = {
  readonly verify?: VerifySessionToken;
  readonly intentService?: ScoreboardIntentServiceInterface;
  readonly socketService?: ScoreboardSocketInterface;
};

const VERIFIED_TOKEN_TTL_MS = 60_000;

const readCode = (payload: unknown): string | null => {
  if (typeof payload === "string") return payload;
  if (typeof payload === "object" && payload !== null) {
    const code = (payload as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return null;
};

const readToken = (payload: unknown): string | null => {
  if (typeof payload === "object" && payload !== null) {
    const token = (payload as { token?: unknown }).token;
    if (typeof token === "string" && token.length > 0) return token;
  }
  return null;
};

const statusOf = (error: unknown): number =>
  typeof error === "object" && error !== null && "code" in error
    ? Number((error as { code: unknown }).code)
    : 500;

const messageOf = (error: unknown): string =>
  typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message)
    : "Internal Server Error";

const settle = <A, E>(
  effect: Effect.Effect<A, E>,
  onSuccess: (value: A) => void,
  onFailure: (error: E) => void,
): void => {
  Effect.runPromise(
    effect.pipe(
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

export const registerScoreboardHandlers = (io: Server, deps?: ScoreboardHandlerDeps): void => {
  const verify = deps?.verify ?? verifySessionTokenLive;
  const intents = deps?.intentService ?? intentService;
  const sockets = deps?.socketService ?? socketService;
  // Verify-before-apply per intent; verified tokens are cached per socket with a
  // short TTL so rapid score taps do not pay Clerk latency on every tap.
  const verifiedBySocket = new WeakMap<object, Map<string, { userId: string; until: number }>>();

  const verifiedUserId = (socket: object, token: string): Effect.Effect<string, { code: number; message: string }> =>
    Effect.gen(function* () {
      let cached = verifiedBySocket.get(socket);
      if (!cached) {
        cached = new Map();
        verifiedBySocket.set(socket, cached);
      }
      const hit = cached.get(token);
      if (hit && hit.until > Date.now()) return hit.userId;
      const claims = yield* verify(token).pipe(
        Effect.mapError(() => ({ code: 401, message: "Sign in to change this board" })),
      );
      cached.set(token, { userId: claims.userId, until: Date.now() + VERIFIED_TOKEN_TTL_MS });
      return claims.userId;
    });

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

      const token = readToken(payload);
      if (!token) {
        respond({ ok: false, code: 401, message: "Sign in to change this board" });
        return;
      }

      settle(
        Effect.gen(function* () {
          const userId = yield* verifiedUserId(socket, token);
          return yield* intents.applyIntentToCode(code, intent, userId);
        }),
        (scoreboard) => {
          // Broadcast-then-ack is intentional; the sender receives both.
          Effect.runPromise(sockets.updateScoreboard(scoreboard)).catch((fatal: unknown) => {
            console.error(`[scoreboard] broadcast to ${roomFor(scoreboard.code)} failed`, fatal);
          });
          respond({ ok: true, scoreboard });
        },
        (error) => respond({ ok: false, code: statusOf(error), message: messageOf(error) }),
      );
    });
  });
};
