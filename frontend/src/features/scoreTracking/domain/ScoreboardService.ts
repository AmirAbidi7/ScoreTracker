import { ApiClient, apiClient, type TokenProvider } from "../../../../infrastructure/api/client";
import {
  createSocket,
  joinRoom,
  leaveRoom,
  sendIntent as emitIntent,
  type ScoreboardAck,
  type SocketLike,
} from "../../../../infrastructure/socket/scoreboardSocket";
import type { Scoreboard } from "./Scoreboard";
import type { ScoreboardIntent } from "./ScoreboardIntent";

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline";

export type ServiceEvent =
  | { type: "status"; status: ConnectionStatus }
  | { type: "board"; board: Scoreboard }
  | { type: "disconnected" }
  | { type: "error"; message: string };

export type SendIntentResult =
  | ScoreboardAck
  | { readonly ok: "superseded"; readonly board: Scoreboard };

export type ScoreboardServiceOptions = {
  apiClient?: ApiClient;
  createSocket?: () => SocketLike;
  reconnectDelays?: number[];
  tokenProvider?: TokenProvider;
};

const DEFAULT_RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000];

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const settle = <T>(
  read: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; message: string }> =>
  Promise.resolve()
    .then(read)
    .then(
      (value) => ({ ok: true, value }),
      (error: unknown) => ({ ok: false, message: messageOf(error) }),
    );

export class ScoreboardService {
  private readonly api: ApiClient;
  private readonly createSocket: () => SocketLike;
  private readonly reconnectDelays: number[];
  private tokenProvider: TokenProvider | null;

  private socket: SocketLike | null = null;
  private handlers: Record<string, (...args: any[]) => void> = {};
  private listeners = new Set<(event: ServiceEvent) => void>();
  private status: ConnectionStatus = "idle";
  private retryIndex = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private current: Scoreboard | null = null;
  private connected = false;

  constructor(options: ScoreboardServiceOptions = {}) {
    this.api = options.apiClient ?? apiClient;
    this.createSocket = options.createSocket ?? (() => createSocket());
    this.reconnectDelays = options.reconnectDelays ?? DEFAULT_RECONNECT_DELAYS;
    this.tokenProvider = options.tokenProvider ?? null;
  }

  setTokenProvider(provider: TokenProvider | null): void {
    this.tokenProvider = provider;
  }

  private resolveToken(): Promise<string | null> {
    if (!this.tokenProvider) return Promise.resolve(null);
    return this.tokenProvider().catch(() => null);
  }

  get currentCode(): string | null {
    return this.current?.code ?? null;
  }

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  subscribe(listener: (event: ServiceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: ServiceEvent): void {
    this.listeners.forEach((listener) => listener(event));
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.emit({ type: "status", status });
  }

  private ensureSocket(): SocketLike {
    if (this.socket) return this.socket;

    const socket = this.createSocket();
    this.socket = socket;

    this.connected = socket.connected;

    this.handlers = {
      connect: () => {
        this.connected = true;
        this.retryIndex = 0;
        this.clearRetryTimer();
        this.setStatus("connected");
        void this.resync(socket);
      },

      disconnect: () => {
        this.connected = false;
        this.scheduleReconnect();
      },

      connect_error: (error: Error) => {
        this.connected = false;
        this.scheduleReconnect();
        this.emit({ type: "error", message: messageOf(error) });
      },

      "scoreboard:update": (board: Scoreboard) => {
        this.current = board;
        this.emit({ type: "board", board });
      },

      "scoreboard:disconnect": () => {
        this.teardown();
        this.current = null;
        this.setStatus("idle");
        this.emit({ type: "disconnected" });
      },
    };

    for (const [event, handler] of Object.entries(this.handlers)) {
      socket.on(event, handler);
    }

    return socket;
  }

  private async resync(socket: SocketLike): Promise<void> {
    const board = this.current;
    if (!board) return;
    const boardId = board.id;

    const read = await settle(() => this.api.getScoreboard(boardId));

    if (!this.stillTracking(socket, boardId)) return;

    if (read.ok) {
      this.current = read.value;
      this.emit({ type: "board", board: read.value });
      joinRoom(socket, read.value.code);
    } else {
      this.emit({ type: "error", message: read.message });
      joinRoom(socket, board.code);
    }
  }

  // `stillTracking`/`resync` gate on the tracked board; one live socket at a time.
  private stillTracking(socket: SocketLike, boardId: string): boolean {
    return this.socket === socket && this.current?.id === boardId;
  }

  private scheduleReconnect(): void {
    if (this.retryTimer !== null) return;

    const hasBoard = this.current !== null;
    this.setStatus(hasBoard ? "reconnecting" : "offline");

    const delay = this.reconnectDelays[Math.min(this.retryIndex, this.reconnectDelays.length - 1)];
    this.retryIndex += 1;

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.current === null) return;
      this.socket?.connect();
    }, delay);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer === null) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private teardown(): void {
    this.clearRetryTimer();

    const { socket, handlers } = this;
    this.socket = null;
    this.handlers = {};
    this.connected = false;
    this.retryIndex = 0;

    if (!socket) return;
    for (const [event, handler] of Object.entries(handlers)) {
      socket.off(event, handler);
    }
    socket.disconnect();
  }

  async createScoreboard(gameName: string): Promise<Scoreboard> {
    const board = await this.api.createScoreboard(gameName);
    this.enterBoard(board);
    return board;
  }

  async joinScoreboard(code: string): Promise<Scoreboard> {
    const board = await this.api.joinScoreboard(code);
    this.enterBoard(board);
    return board;
  }

  private enterBoard(board: Scoreboard): void {
    this.teardown();
    this.current = board;
    this.emit({ type: "board", board });

    const socket = this.ensureSocket();
    this.setStatus(socket.connected ? "connected" : "connecting");
    joinRoom(socket, board.code);
  }

  listScoreboards(): Promise<Scoreboard[]> {
    return this.api.listScoreboards();
  }

  async leaveScoreboard(): Promise<void> {
    const board = this.current;
    if (board && this.socket) leaveRoom(this.socket, board.code);
    this.teardown();
    this.current = null;
    this.setStatus("idle");
  }

  async deleteCurrentScoreboard(): Promise<void> {
    const board = this.current;
    if (!board) return;
    await this.api.deleteScoreboard(board.id);
    if (this.socket) leaveRoom(this.socket, board.code);
    this.teardown();
    this.current = null;
    this.setStatus("idle");
  }

  async claimScoreboard(): Promise<Scoreboard> {
    const board = this.current;
    if (!board) throw new Error("No board to claim");
    const claimed = await this.api.claimScoreboard(board.id);
    this.current = claimed;
    this.emit({ type: "board", board: claimed });
    return claimed;
  }

  sendIntent(intent: ScoreboardIntent): Promise<SendIntentResult> {
    const socket = this.socket;
    const board = this.current;
    if (!board || !socket || !this.connected) {
      return Promise.resolve({ ok: false, code: 0, message: "Not connected to the server" });
    }
    const boardId = board.id;
    return this.resolveToken().then((token) =>
      emitIntent(socket, board.code, intent, token).then((ack) =>
        !ack.ok || this.stillTracking(socket, boardId) ? ack : { ok: "superseded", board: ack.scoreboard },
      ),
    );
  }
}

export const scoreboardService = new ScoreboardService();
