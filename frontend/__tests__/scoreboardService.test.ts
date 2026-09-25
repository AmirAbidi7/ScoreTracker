/// <reference types="jest" />
import type { ApiClient } from "../infrastructure/api/client";
import type { SocketLike } from "../infrastructure/socket/scoreboardSocket";
import {
  ScoreboardService,
  type ServiceEvent,
} from "../src/features/scoreTracking/domain/ScoreboardService";
import type { Scoreboard } from "../src/features/scoreTracking/domain/Scoreboard";

/**
 * `(...args: any[]) => void` and not `never[]`: this is the handler shape
 * `SocketLike` declares, and a fake typed against anything else cannot invoke a
 * captured handler with a real payload. See the comment on `SocketLike` in
 * `scoreboardSocket.ts` for why the `any` is load-bearing.
 */
type Handlers = Record<string, (...args: any[]) => void>;

const board: Scoreboard = {
  id: "board-1",
  gameName: "Catan",
  code: "AB12CD",
  players: [{ id: 1, name: "Amir", score: 3 }],
  updateTime: "2026-09-25T10:00:00.000Z",
};

const makeFakeSocket = () => {
  const handlers: Handlers = {};
  const emitted: { event: string; args: unknown[] }[] = [];
  const socket: SocketLike & { handlers: Handlers; emitted: typeof emitted } = {
    connected: true,
    connect: jest.fn(),
    // The real client emits `disconnect` when it is disconnected locally, and
    // the service calls `disconnect()` on every teardown. A fake that swallowed
    // that would hide exactly the bug the leave test is looking for.
    disconnect: jest.fn(() => {
      handlers["disconnect"]?.("io client disconnect");
    }),
    on: jest.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handler;
    }),
    // Removal is real, not a `jest.fn()` that records the call and forgets: "the
    // service detached this listener" is what the leave test turns on, and a
    // fake that kept the handler would let it pass vacuously.
    off: jest.fn((event: string, handler?: (...args: any[]) => void) => {
      if (handler && handlers[event] === handler) delete handlers[event];
    }),
    emit: jest.fn((event: string, ...args: unknown[]) => {
      emitted.push({ event, args });
    }),
    handlers,
    emitted,
  };
  return socket;
};

const makeApi = (overrides: Partial<Record<string, jest.Mock>> = {}) =>
  ({
    createScoreboard: overrides.createScoreboard ?? jest.fn().mockResolvedValue(board),
    joinScoreboard: overrides.joinScoreboard ?? jest.fn().mockResolvedValue(board),
    getScoreboard: overrides.getScoreboard ?? jest.fn().mockResolvedValue(board),
    listScoreboards: overrides.listScoreboards ?? jest.fn().mockResolvedValue([board]),
    deleteScoreboard: overrides.deleteScoreboard ?? jest.fn().mockResolvedValue(undefined),
  }) as unknown as ApiClient;

const build = (socket: SocketLike, api = makeApi()) => {
  const events: ServiceEvent[] = [];
  const service = new ScoreboardService({
    apiClient: api,
    createSocket: () => socket,
    reconnectDelays: [1, 2],
  });
  service.subscribe((event) => {
    events.push(event);
  });
  return { service, events, api };
};

/** The statuses an observer saw, in order. */
const statusesOf = (events: ServiceEvent[]): string[] =>
  events.flatMap((event) => (event.type === "status" ? [event.status] : []));

const joinsOn = (socket: { emitted: { event: string; args: unknown[] }[] }): number =>
  socket.emitted.filter((e) => e.event === "scoreboard:join").length;

/**
 * Crosses a task boundary so the `connect` handler's pending
 * `getScoreboard(...).then(...)` runs. Asserting straight after firing the
 * handler sees one room join, not two: the re-join happens after the re-read
 * resolves, not during the handler.
 */
const flushAsync = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

const fireUpdate = (socket: ReturnType<typeof makeFakeSocket>, next: Scoreboard): void => {
  (socket.handlers["scoreboard:update"] as (board: Scoreboard) => void)(next);
};

describe("ScoreboardService", () => {
  test("joinScoreboard emits a room join and reports connected", async () => {
    const socket = makeFakeSocket();
    const { service, events } = build(socket);

    const result = await service.joinScoreboard("AB12CD");

    expect(result).toEqual(board);
    expect(socket.emitted.map((e) => e.event)).toContain("scoreboard:join");
    expect(events).toContainEqual({ type: "status", status: "connected" });
  });

  test("an inbound board is forwarded to subscribers", async () => {
    const socket = makeFakeSocket();
    const { service, events } = build(socket);
    await service.joinScoreboard("AB12CD");

    const next: Scoreboard = { ...board, players: [{ id: 1, name: "Amir", score: 9 }] };
    fireUpdate(socket, next);

    expect(events).toContainEqual({ type: "board", board: next });
  });

  test("scoreboard:disconnect is surfaced and the code is forgotten", async () => {
    const socket = makeFakeSocket();
    const { service, events } = build(socket);
    await service.joinScoreboard("AB12CD");

    (socket.handlers["scoreboard:disconnect"] as () => void)();

    expect(events).toContainEqual({ type: "disconnected" });
    expect(service.currentCode).toBeNull();
    expect(service.connectionStatus).toBe("idle");
  });

  test("a rejected intent resolves the promise instead of throwing", async () => {
    const socket = makeFakeSocket();
    const { service } = build(socket);
    await service.joinScoreboard("AB12CD");

    const promise = service.sendIntent({ type: "addScore", playerId: 99, amount: 5 });
    const intentEmit = socket.emitted.find((e) => e.event === "scoreboard:intent");
    const ack = intentEmit!.args[1] as (a: unknown) => void;
    ack({ ok: false, code: 400, message: "no such player" });

    await expect(promise).resolves.toEqual({ ok: false, code: 400, message: "no such player" });
  });

  test("sendIntent while disconnected resolves offline rather than emitting", async () => {
    const socket = makeFakeSocket();
    socket.connected = false;
    const { service } = build(socket);

    const result = await service.sendIntent({ type: "addPlayer", name: "Amir" });

    expect(result).toEqual({ ok: false, code: 0, message: "Not connected to the server" });
    expect(socket.emitted.map((e) => e.event)).not.toContain("scoreboard:intent");
  });

  test("reconnecting re-fetches the board and re-joins the room", async () => {
    const socket = makeFakeSocket();
    const getScoreboard = jest.fn().mockResolvedValue({ ...board, players: [] });
    const { service, events } = build(socket, makeApi({ getScoreboard }));
    await service.joinScoreboard("AB12CD");

    (socket.handlers["disconnect"] as (reason: string) => void)("transport close");
    (socket.handlers["connect"] as () => void)();
    await flushAsync();

    expect(getScoreboard).toHaveBeenCalledWith("board-1");
    expect(joinsOn(socket)).toBe(2);
    // The board read back from the server, not the one held before the drop.
    expect(events).toContainEqual({ type: "board", board: { ...board, players: [] } });
    // It passes through `reconnecting` rather than snapping back to `connected`.
    expect(statusesOf(events)).toEqual(["connected", "reconnecting", "connected"]);
  });

  test("a reconnect whose board re-read fails still re-joins the room and reports it", async () => {
    const socket = makeFakeSocket();
    const getScoreboard = jest.fn().mockRejectedValue(new Error("Can't reach the server"));
    const { service, events } = build(socket, makeApi({ getScoreboard }));
    await service.joinScoreboard("AB12CD");

    (socket.handlers["disconnect"] as (reason: string) => void)("transport close");
    (socket.handlers["connect"] as () => void)();
    await flushAsync();

    // A failed re-read is reported, not swallowed.
    expect(events).toContainEqual({ type: "error", message: "Can't reach the server" });
    // Room membership is the part that does not recover on its own, so the
    // re-join goes out anyway and the last known board stays tracked.
    expect(joinsOn(socket)).toBe(2);
    expect(service.currentCode).toBe("AB12CD");
  });

  test("deleteScoreboard clears the tracked code", async () => {
    const socket = makeFakeSocket();
    const { service } = build(socket);
    await service.joinScoreboard("AB12CD");

    await service.deleteCurrentScoreboard();

    expect(service.currentCode).toBeNull();
    expect(socket.emitted.map((e) => e.event)).toContain("scoreboard:leave");
  });

  test("leaving detaches the socket so a discarded one cannot resurrect the connection", async () => {
    const socket = makeFakeSocket();
    const { service, events } = build(socket);
    await service.joinScoreboard("AB12CD");

    await service.leaveScoreboard();

    // A deliberate disconnect fires the socket's own `disconnect` event, and the
    // real client emits it just like the fake above. With the handler still
    // attached, leaving would schedule a reconnect for a socket the app has
    // thrown away: a stray timer that outlives the screen, and a `reconnecting`
    // status on the way to `idle`.
    expect(statusesOf(events)).toEqual(["connected", "idle"]);
    expect(Object.keys(socket.handlers)).toEqual([]);
    expect(service.connectionStatus).toBe("idle");
    expect(joinsOn(socket)).toBe(1);
  });

  test("unsubscribe stops delivery, and re-subscribing does not duplicate it", async () => {
    const socket = makeFakeSocket();
    const { service } = build(socket);
    await service.joinScoreboard("AB12CD");

    const stopped: ServiceEvent[] = [];
    const live: ServiceEvent[] = [];
    const stop = service.subscribe((event) => void stopped.push(event));
    service.subscribe((event) => void live.push(event));
    stop();

    const next: Scoreboard = { ...board, players: [{ id: 1, name: "Amir", score: 12 }] };
    fireUpdate(socket, next);

    expect(stopped).toEqual([]);
    expect(live).toEqual([{ type: "board", board: next }]);
  });
});
