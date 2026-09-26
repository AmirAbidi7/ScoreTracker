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

type FakeSocket = SocketLike & {
  handlers: Handlers;
  emitted: { event: string; args: unknown[] }[];
  connect: jest.Mock;
  disconnect: jest.Mock;
  off: jest.Mock;
};

const board: Scoreboard = {
  id: "board-1",
  gameName: "Catan",
  code: "AB12CD",
  players: [{ id: 1, name: "Amir", score: 3 }],
  updateTime: "2026-09-25T10:00:00.000Z",
};

const otherBoard: Scoreboard = {
  id: "board-2",
  gameName: "Catan",
  code: "ZZ99YY",
  players: [{ id: 7, name: "Bo", score: 1 }],
  updateTime: "2026-09-25T11:00:00.000Z",
};

const makeFakeSocket = (): FakeSocket => {
  const handlers: Handlers = {};
  const emitted: { event: string; args: unknown[] }[] = [];
  const socket: FakeSocket = {
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

/**
 * Hands out one fake per socket the service asks for, so a test can tell the
 * teardown of a socket from the creation of its replacement. Asking for more
 * than it supplied is a test bug and says so instead of silently reusing one.
 */
const buildSockets = (
  sockets: FakeSocket[],
  api = makeApi(),
  reconnectDelays: number[] = [1, 2],
) => {
  const queue = [...sockets];
  const events: ServiceEvent[] = [];
  const service = new ScoreboardService({
    apiClient: api,
    createSocket: () => {
      const next = queue.shift();
      if (!next) throw new Error("the test supplied fewer sockets than the service asked for");
      return next;
    },
    reconnectDelays,
  });
  service.subscribe((event) => {
    events.push(event);
  });
  return { service, events };
};

const build = (socket: FakeSocket, api = makeApi(), reconnectDelays: number[] = [1, 2]) =>
  buildSockets([socket], api, reconnectDelays);

/** The statuses an observer saw, in order. */
const statusesOf = (events: ServiceEvent[]): string[] =>
  events.flatMap((event) => (event.type === "status" ? [event.status] : []));

const joinsOn = (socket: FakeSocket): number =>
  socket.emitted.filter((e) => e.event === "scoreboard:join").length;

const fireConnect = (socket: FakeSocket): void => {
  (socket.handlers["connect"] as () => void)();
};

const fireDisconnect = (socket: FakeSocket): void => {
  (socket.handlers["disconnect"] as (reason: string) => void)("transport close");
};

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

/** A promise the test resolves by hand, so work can be held open across an await. */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const fireUpdate = (socket: FakeSocket, next: Scoreboard): void => {
  (socket.handlers["scoreboard:update"] as (board: Scoreboard) => void)(next);
};

describe("ScoreboardService", () => {
  test("joinScoreboard emits a room join and reports connected", async () => {
    const socket = makeFakeSocket();
    const { service, events } = build(socket);

    const result = await service.joinScoreboard("AB12CD");

    expect(result).toEqual(board);
    expect(socket.emitted).toContainEqual({ event: "scoreboard:join", args: [{ code: "AB12CD" }] });
    expect(events).toContainEqual({ type: "status", status: "connected" });
  });

  test("createScoreboard enters the board it made and joins its room", async () => {
    const socket = makeFakeSocket();
    const createScoreboard = jest.fn().mockResolvedValue(board);
    const { service } = build(socket, makeApi({ createScoreboard }));

    const result = await service.createScoreboard("Catan");

    // The first-run path into `enterBoard`, so the board it just made is the one
    // that gets tracked and joined — not just returned to the caller.
    expect(createScoreboard).toHaveBeenCalledWith("Catan");
    expect(result).toEqual(board);
    expect(service.currentCode).toBe("AB12CD");
    expect(socket.emitted).toContainEqual({ event: "scoreboard:join", args: [{ code: "AB12CD" }] });
    expect(service.connectionStatus).toBe("connected");
  });

  test("listScoreboards returns boards without entering one", async () => {
    const socket = makeFakeSocket();
    const listScoreboards = jest.fn().mockResolvedValue([board, otherBoard]);
    const { service } = build(socket, makeApi({ listScoreboards }));

    await expect(service.listScoreboards()).resolves.toEqual([board, otherBoard]);

    // Browsing is not entering: no board is tracked and no socket is opened, or
    // a screen that lists boards would take over the live connection.
    expect(listScoreboards).toHaveBeenCalledWith();
    expect(service.currentCode).toBeNull();
    expect(service.connectionStatus).toBe("idle");
    expect(socket.emitted).toEqual([]);
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

  test("an intent sent while the socket is down resolves offline rather than emitting", async () => {
    const socket = makeFakeSocket();
    const { service } = build(socket);
    await service.joinScoreboard("AB12CD");
    // A board is tracked and the socket still exists, so the only thing that can
    // make this the offline case is the connection itself being down.
    fireDisconnect(socket);

    const result = await service.sendIntent({ type: "addPlayer", name: "Amir" });

    expect(result).toEqual({ ok: false, code: 0, message: "Not connected to the server" });
    expect(socket.emitted.map((e) => e.event)).not.toContain("scoreboard:intent");
  });

  test("an intent sent with no board resolves offline rather than emitting", async () => {
    const socket = makeFakeSocket();
    const { service } = build(socket);

    const result = await service.sendIntent({ type: "addPlayer", name: "Amir" });

    expect(result).toEqual({ ok: false, code: 0, message: "Not connected to the server" });
    expect(socket.emitted).toEqual([]);
  });

  test("reconnecting re-fetches the board and re-joins the room", async () => {
    const socket = makeFakeSocket();
    const getScoreboard = jest.fn().mockResolvedValue({ ...board, players: [] });
    const { service, events } = build(socket, makeApi({ getScoreboard }));
    await service.joinScoreboard("AB12CD");

    fireDisconnect(socket);
    fireConnect(socket);
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

    fireDisconnect(socket);
    fireConnect(socket);
    await flushAsync();

    // A failed re-read is reported, not swallowed.
    expect(events).toContainEqual({ type: "error", message: "Can't reach the server" });
    // Room membership is the part that does not recover on its own, so the
    // re-join goes out anyway and the last known board stays tracked.
    expect(joinsOn(socket)).toBe(2);
    expect(service.currentCode).toBe("AB12CD");
  });

  test("a re-read that lands after the user has left does not resurrect the board", async () => {
    const socket = makeFakeSocket();
    const reRead = deferred<Scoreboard>();
    const getScoreboard = jest.fn().mockReturnValue(reRead.promise);
    const { service, events } = build(socket, makeApi({ getScoreboard }));
    await service.joinScoreboard("AB12CD");

    fireDisconnect(socket);
    fireConnect(socket); // the re-read is now in flight
    await service.leaveScoreboard();

    // The answer arrives after the teardown, describing a board nobody is on.
    const stale: Scoreboard = { ...board, players: [{ id: 1, name: "Amir", score: 7 }] };
    reRead.resolve(stale);
    await flushAsync();

    expect(service.currentCode).toBeNull();
    expect(events).not.toContainEqual({ type: "board", board: stale });
    // And the discarded socket is not dragged back into a room.
    expect(joinsOn(socket)).toBe(1);
  });

  test("switching boards mid-re-read cannot leave the tracked board and the joined room disagreeing", async () => {
    const first = makeFakeSocket();
    const second = makeFakeSocket();
    const reRead = deferred<Scoreboard>();
    const getScoreboard = jest.fn().mockReturnValueOnce(reRead.promise);
    const joinScoreboard = jest
      .fn()
      .mockResolvedValueOnce(board)
      .mockResolvedValueOnce(otherBoard);
    const { service, events } = buildSockets([first, second], makeApi({ getScoreboard, joinScoreboard }));
    await service.joinScoreboard("AB12CD");

    fireDisconnect(first);
    fireConnect(first); // A's re-read is in flight
    await service.joinScoreboard("ZZ99YY"); // B becomes the tracked board, on a new socket

    const stale: Scoreboard = { ...board, players: [{ id: 1, name: "Amir", score: 7 }] };
    reRead.resolve(stale);
    await flushAsync();

    expect(service.currentCode).toBe("ZZ99YY");
    expect(joinsOn(first)).toBe(1);
    expect(joinsOn(second)).toBe(1);
    expect(events).not.toContainEqual({ type: "board", board: stale });

    // The point of the whole thing: an intent now goes to B, where the socket is.
    const pending = service.sendIntent({ type: "addScore", playerId: 7, amount: 1 });
    const intent = second.emitted.find((e) => e.event === "scoreboard:intent");
    expect(intent!.args[0]).toEqual({
      code: "ZZ99YY",
      intent: { type: "addScore", playerId: 7, amount: 1 },
    });
    (intent!.args[1] as (ack: unknown) => void)({ ok: false, code: 0, message: "settled" });
    await pending;
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

  test("a listener that unsubscribes and re-subscribes is delivered to once", async () => {
    const socket = makeFakeSocket();
    const { service } = build(socket);
    await service.joinScoreboard("AB12CD");

    const at = (score: number): Scoreboard => ({
      ...board,
      players: [{ id: 1, name: "Amir", score }],
    });
    const seen: ServiceEvent[] = [];
    const listener = (event: ServiceEvent) => void seen.push(event);

    const stop = service.subscribe(listener);
    fireUpdate(socket, at(4));
    stop();
    fireUpdate(socket, at(8));
    // The *same* function, not a second one: an array-backed registry would
    // deliver twice from here on, and every later update would be doubled.
    service.subscribe(listener);
    fireUpdate(socket, at(12));
    // And a re-render that re-subscribes before its cleanup runs must not stack
    // a second copy either — that is the duplicate the `Set` is there to stop.
    service.subscribe(listener);
    fireUpdate(socket, at(16));

    expect(seen).toEqual([
      { type: "board", board: at(4) },
      { type: "board", board: at(12) },
      { type: "board", board: at(16) },
    ]);
  });
});

/**
 * The backoff schedule is injected so these tests do not wait in real time, so
 * they use fake timers to drive the ticks deterministically. Real timers are
 * restored afterwards, and nothing here may await `flushAsync` — that is a
 * `setTimeout`, which would never fire.
 */
describe("ScoreboardService backoff", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("the backoff timer pokes connect() only once its delay has elapsed, and backs off further", async () => {
    const socket = makeFakeSocket();
    const { service } = build(socket, makeApi(), [1000, 2000]);
    await service.joinScoreboard("AB12CD");

    fireDisconnect(socket);
    jest.advanceTimersByTime(999);
    expect(socket.connect).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(socket.connect).toHaveBeenCalledTimes(1);

    // Second failure waits the next delay in the schedule, not the first again.
    fireDisconnect(socket);
    jest.advanceTimersByTime(1999);
    expect(socket.connect).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1);
    expect(socket.connect).toHaveBeenCalledTimes(2);
  });

  test("a connect that beats the backoff timer cancels it", async () => {
    const socket = makeFakeSocket();
    const { service } = build(socket, makeApi(), [1000]);
    await service.joinScoreboard("AB12CD");

    // socket.io reconnects on its own, and does not have to wait for our timer.
    fireDisconnect(socket);
    fireConnect(socket);
    jest.advanceTimersByTime(1000);

    // Otherwise the timer fires against a live socket and calls connect() on it.
    expect(socket.connect).not.toHaveBeenCalled();
  });

  test("a backoff timer armed before leaving does not outlive the board", async () => {
    const first = makeFakeSocket();
    const second = makeFakeSocket();
    const { service } = buildSockets([first, second], makeApi(), [1000]);
    await service.joinScoreboard("AB12CD");

    fireDisconnect(first); // arms a 1s retry
    await service.leaveScoreboard();
    // Entering another board puts a live socket and a tracked board back in
    // place, which is exactly what a leaked timer would find and poke.
    await service.joinScoreboard("ZZ99YY");

    jest.advanceTimersByTime(1000);

    expect(first.connect).not.toHaveBeenCalled();
    expect(second.connect).not.toHaveBeenCalled();
  });
});
