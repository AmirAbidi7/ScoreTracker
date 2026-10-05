import { io, type Socket } from "socket.io-client";
import { SOCKET_URL } from "../api/config";
import type { Scoreboard } from "../../src/features/scoreTracking/domain/Scoreboard";
import type { ScoreboardIntent } from "../../src/features/scoreTracking/domain/ScoreboardIntent";

// The `any[]` on `SocketLike`'s handlers is load-bearing; `unknown[]`/`never[]` make the seam unmockable.
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
  const socket: Socket = io(url, {
    transports: ["websocket"],
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
  token?: string | null,
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

    const timer = setTimeout(
      () => finish({ ok: false, code: 0, message: "The server did not respond in time" }),
      timeoutMs,
    );

    socket.emit("scoreboard:intent", { code, intent, ...(token ? { token } : {}) }, finish);
  });
