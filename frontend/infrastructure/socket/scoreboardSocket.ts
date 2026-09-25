import { io, type Socket } from "socket.io-client";
import { SOCKET_URL } from "../api/config";
import type { Scoreboard } from "../../src/features/scoreTracking/domain/Scoreboard";
import type { ScoreboardIntent } from "../../src/features/scoreTracking/domain/ScoreboardIntent";

/**
 * The subset of socket.io-client the app uses. Depending on an interface
 * rather than the concrete `Socket` is what lets the gateway be tested
 * without a server.
 *
 * `on`/`off` take `(...args: any[]) => void` and that `any` is load-bearing.
 * It is the same shape socket.io itself uses for an untyped listener
 * (`DefaultEventsMap`), and it is the only shape of the three that is both
 * assignable from the real `Socket` and usable from a hand-written fake:
 *
 * - `(...args: never[]) => void` accepts a typed handler, but a test double
 *   cannot invoke a captured handler with a real payload — `h(board)` is a
 *   type error, because `Scoreboard` is not assignable to `never`. That
 *   defeats the entire point of this file.
 * - `(...args: unknown[]) => void` looks safer and is worse in practice: it
 *   rejects every realistic use. A typed handler is refused (a rest-`unknown`
 *   parameter position is not bivariant, so `(b: Scoreboard) => ...` does not
 *   match), an unannotated handler infers its argument as a bare `unknown`, and
 *   a double that stores the handler it was given infers that handler as
 *   `unknown` too, so it can neither call nor re-register what it captured.
 *
 * Do not "tidy" this into `unknown` or `never`. `ScoreboardSocketEvents` is the
 * typed view of these events for consumers that want one.
 */
export interface SocketLike {
  connected: boolean;
  connect(): void;
  disconnect(): void;
  on(event: string, handler: (...args: any[]) => void): void;
  off(event: string, handler?: (...args: any[]) => void): void;
  emit(event: string, ...args: unknown[]): void;
}

export type ScoreboardAck =
  | { ok: true; scoreboard: Scoreboard }
  | { ok: false; code: number; message: string };

export type ScoreboardSocketEvents = {
  "scoreboard:update": (board: Scoreboard) => void;
  "scoreboard:disconnect": () => void;
  connect: () => void;
  disconnect: (reason: string) => void;
  connect_error: (error: Error) => void;
};

export const createSocket = (url: string = SOCKET_URL): SocketLike => {
  // The concrete `Socket` is named in exactly this one function and nowhere
  // else. It is returned as a `SocketLike` by ordinary assignment rather than
  // an `as unknown as` cast so the compiler checks that `SocketLike` still
  // describes the real client: if a future upgrade of socket.io-client
  // changes `on`/`off`/`emit`, this stops compiling instead of failing at
  // runtime behind a laundering cast.
  const socket: Socket = io(url, {
    transports: ["websocket"],
    // Without this, a phone that backgrounds the app for a minute comes back
    // to a silently dead socket and the board stops updating.
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 15000,
    forceNew: true,
  });

  return socket;
};

export const joinRoom = (socket: SocketLike, code: string): void => {
  socket.emit("scoreboard:join", { code });
};

export const leaveRoom = (socket: SocketLike, code: string): void => {
  socket.emit("scoreboard:leave", { code });
};

export const sendIntent = (
  socket: SocketLike,
  code: string,
  intent: ScoreboardIntent,
  timeoutMs = 8000,
): Promise<ScoreboardAck> =>
  new Promise((resolve) => {
    if (!socket.connected) {
      resolve({ ok: false, code: 0, message: "Not connected to the server" });
      return;
    }

    let settled = false;
    const finish = (ack: ScoreboardAck) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ack);
    };

    // A server that accepts the emit but never acks (a crash between the two)
    // would otherwise hang the pending counter forever and leave the UI
    // spinning. A timeout is a visible failure; a hang is not.
    const timer = setTimeout(
      () => finish({ ok: false, code: 0, message: "The server did not respond in time" }),
      timeoutMs,
    );

    socket.emit("scoreboard:intent", { code, intent }, finish);
  });
