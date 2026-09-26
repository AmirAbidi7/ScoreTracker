import { ApiClient, apiClient } from "../../../../infrastructure/api/client";
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

/**
 * What `sendIntent` reports.
 *
 * `superseded` is the service's own answer and never the server's: the server did
 * apply the intent — to a board this device has since left. It is not a failure
 * and not a success, and folding it into either would be a lie the user reads
 * ("Not connected" / a red refusal for a game they walked away from). Named and
 * separate so the caller can decline to show a board nobody is on without
 * inventing a reason. See `sendIntent` for why the ack needs a gate at all.
 */
export type SendIntentResult =
  | ScoreboardAck
  | { readonly ok: "superseded"; readonly board: Scoreboard };

export type ScoreboardServiceOptions = {
  apiClient?: ApiClient;
  createSocket?: () => SocketLike;
  /** Backoff schedule in ms. Overridable so tests do not wait in real time. */
  reconnectDelays?: number[];
};

const DEFAULT_RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 15000];

/**
 * A `connect_error` payload is an `Error` in practice and `ApiClientError` on
 * the REST path, but nothing guarantees it, and a subscriber must never be
 * handed `undefined` as a message.
 */
const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Runs `read` and turns a failure into a value, so one staleness check can gate
 * both outcomes. A `try`/`catch` around the read would need that check repeated
 * in each arm, and an arm that forgot it would commit a board the app has
 * already moved on from.
 *
 * The thunk is load-bearing, not stylistic. `ApiClient`'s methods are not
 * `async`, and `encodePathSegment` throws for an unpaired surrogate, so a read
 * can fail *before* it returns a promise. Passing such a call as an argument
 * evaluates it first, and the throw would escape the caller entirely — and that
 * caller is `void this.resync(...)`, which discards it as an unhandled
 * rejection. The call happens in here instead, where a throw and a rejection
 * arrive at the same handler.
 */
const settle = <T>(
  read: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; message: string }> =>
  // `Promise.resolve().then(read)` invokes `read` inside a then-callback, which
  // turns a synchronous throw into a rejection for the handler below to catch.
  Promise.resolve()
    .then(read)
    .then(
      (value) => ({ ok: true, value }),
      (error: unknown) => ({ ok: false, message: messageOf(error) }),
    );

/**
 * Owns the REST client and the socket, and nothing else.
 *
 * Deliberately a plain class with no React in sight: it is constructed once as
 * a module singleton and outlives every screen, so tab switches and
 * StrictMode's double-mount cannot tear down a live connection.
 *
 * Components never import this. They dispatch thunks; thunks call this; this
 * pushes results back through `subscribe`.
 */
export class ScoreboardService {
  private readonly api: ApiClient;
  private readonly createSocket: () => SocketLike;
  private readonly reconnectDelays: number[];

  private socket: SocketLike | null = null;
  /**
   * The handlers registered on `socket`, kept so `teardown` can take them off
   * again. The `any[]` is the handler shape `SocketLike` declares; see the
   * comment on that interface for why it is not `never[]` or `unknown[]`.
   */
  private handlers: Record<string, (...args: any[]) => void> = {};
  private listeners = new Set<(event: ServiceEvent) => void>();
  private status: ConnectionStatus = "idle";
  private retryIndex = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Kept so a reconnect can re-read the board and re-join the room. */
  private current: Scoreboard | null = null;
  private connected = false;

  constructor(options: ScoreboardServiceOptions = {}) {
    this.api = options.apiClient ?? apiClient;
    this.createSocket = options.createSocket ?? (() => createSocket());
    this.reconnectDelays = options.reconnectDelays ?? DEFAULT_RECONNECT_DELAYS;
  }

  get currentCode(): string | null {
    return this.current?.code ?? null;
  }

  get connectionStatus(): ConnectionStatus {
    return this.status;
  }

  /** A `Set`, so a re-subscribe after an unsubscribe cannot double-deliver. */
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

  // --- socket lifecycle -------------------------------------------------

  private ensureSocket(): SocketLike {
    if (this.socket) return this.socket;

    const socket = this.createSocket();
    this.socket = socket;

    // `io()` can hand back an already-connected socket, in which case the
    // `connect` event has already fired before we ever subscribed. Seeding from
    // `socket.connected` means a board entered on an already-live connection is
    // immediately usable instead of waiting for a connect that already happened.
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
        // The status first, and the reason second — deliberately, and the order
        // is load-bearing.
        //
        // `scheduleReconnect` reports a status, and the store's `setStatus` clears
        // `error` because a connection that came up is newer news than a failure
        // that has stopped being true. Emitted the other way round — reason, then
        // status, both in this same tick — that clearing landed immediately after
        // and wiped the message before React could render it. Only the second and
        // later failures survived, and only by accident: `scheduleReconnect`
        // early-returns while a retry is armed, so those emit no status to be
        // cleared by.
        //
        // This way the failure is the last word, and the next status change —
        // `connected` on a successful reconnect — is what takes it away, which is
        // the one moment it has genuinely stopped being true.
        this.scheduleReconnect();
        this.emit({ type: "error", message: messageOf(error) });
      },

      "scoreboard:update": (board: Scoreboard) => {
        this.current = board;
        this.emit({ type: "board", board });
      },

      // The board's owner deleted it. Nothing to reconnect to, so the socket
      // goes with it and subscribers are told to leave the screen.
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

  /**
   * Re-reads the current board and re-joins its room on a fresh connection.
   *
   * A reconnect gives the client a brand new server-side socket with no room
   * membership, and socket.io does not replay packets it has already delivered,
   * so re-joining without re-reading leaves the user staring at whatever scores
   * were current when the socket died — silently, and with no recovery until
   * they switch screens. The re-join goes out even if the re-read fails: losing
   * the room is worse than a stale board, and the failure is reported rather
   * than swallowed.
   *
   * `socket` is the instance these handlers were registered on, which is the
   * one whose server-side session is new — never `this.socket`, which may by
   * then be a different socket or gone.
   */
  private async resync(socket: SocketLike): Promise<void> {
    const board = this.current;
    if (!board) return;
    const boardId = board.id;

    const read = await settle(() => this.api.getScoreboard(boardId));

    // One gate on every commit below. See `stillTracking`.
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

  /**
   * Whether a re-read started for `boardId` on `socket` is still worth applying.
   *
   * The re-read is an `await` away from committing, and in that window the board
   * can be left, deleted, or replaced by another one. Committing anyway
   * resurrects a board the user has moved on from, and in the worst case leaves
   * `current` pointing at board A while the live socket sits in board B's room
   * — `sendIntent` posts `current.code`, so that is a silent write to the wrong
   * board rather than a visibly broken one.
   *
   * Both halves are needed and neither subsumes the other: `teardown` nulls the
   * socket but leaves `current` in place, so the socket check is what rejects a
   * leave or a delete; and entering another board installs a different socket
   * over this service, so the id check is what stops a re-read for A being
   * applied once B is the tracked board. A `scoreboard:update` for the same
   * board keeps the id equal, which is intended — ordering out-of-arrival by
   * `updateTime` is the reducer's job, not this layer's.
   *
   * The two places that gate on it, and the same rule in both: `resync` before
   * it commits a board, and `sendIntent` before it hands an ack over. Anything
   * that arrives from the server on behalf of a board is `await` away from
   * committing, and the board can be left or replaced in that window.
   */
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
      // socket.io reconnects on its own; this is the backstop for a socket that
      // has stopped trying.
      this.socket?.connect();
    }, delay);
  }

  private clearRetryTimer(): void {
    if (this.retryTimer === null) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  /**
   * Drops the socket and every listener on it.
   *
   * The listeners come off *before* `disconnect()`, deliberately: a local
   * disconnect still fires the socket's own `disconnect` event, and a handler
   * left attached would schedule a reconnect for a socket the app has just
   * thrown away — a stray timer that outlives the screen and a spurious
   * `reconnecting` on the way to `idle`. Detaching also means a late event from
   * a discarded socket can no longer re-join a room for a board that has been
   * left.
   */
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

  // --- REST operations --------------------------------------------------

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

  /** No `await` in here on purpose: nothing about entering is asynchronous. */
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

  /**
   * A failed delete is the caller's to handle: the board still exists, so the
   * room and the tracked code are left alone and the rejection propagates.
   */
  async deleteCurrentScoreboard(): Promise<void> {
    const board = this.current;
    if (!board) return;
    await this.api.deleteScoreboard(board.id);
    if (this.socket) leaveRoom(this.socket, board.code);
    this.teardown();
    this.current = null;
    this.setStatus("idle");
  }

  // --- intents ----------------------------------------------------------

  /**
   * Resolves a failure ack rather than throwing or queueing: an intent sent
   * while disconnected is a decision the UI has to render, not an exception.
   * `code: 0` is the same "never reached the server" the REST client uses.
   *
   * An ack is gated on the same rule, and through the same helper, as a re-read.
   * `teardown` detaches the listeners and disconnects the socket, but it cannot
   * un-send an intent: the server may still answer one this device has already
   * walked away from. That answer is a board, the caller applies it, and the
   * store goes back to the game the user just left while `current` is the new one
   * — after which the next tap posts the *old* board's `playerId` to the new
   * board's `code`. Player ids restart at 1 per board, so the ids collide, the
   * write succeeds, and the wrong number moves convincingly.
   *
   * So the ack is not returned as a board to apply. `stillTracking` answers it
   * with the same two questions it asks about a re-read — is this still the
   * socket, is this still the board — and a refusal is still reported: a
   * `not found player` for a game the user has left is noise about a game they
   * are not in, but it carries no board, so it cannot be applied by mistake and
   * inventing a reason for it would be a worse lie than showing it.
   */
  sendIntent(intent: ScoreboardIntent): Promise<SendIntentResult> {
    const socket = this.socket;
    const board = this.current;
    if (!board || !socket || !this.connected) {
      return Promise.resolve({ ok: false, code: 0, message: "Not connected to the server" });
    }
    const boardId = board.id;
    return emitIntent(socket, board.code, intent).then((ack) =>
      !ack.ok || this.stillTracking(socket, boardId) ? ack : { ok: "superseded", board: ack.scoreboard },
    );
  }
}

export const scoreboardService = new ScoreboardService();
