/// <reference types="jest" />
import type { ApiClient } from "../infrastructure/api/client";
import type { SocketLike } from "../infrastructure/socket/scoreboardSocket";
import {
  ScoreboardService,
  type ServiceEvent,
} from "../src/features/scoreTracking/domain/ScoreboardService";
import type { Scoreboard } from "../src/features/scoreTracking/domain/Scoreboard";

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
    disconnect: jest.fn(() => {
      handlers["disconnect"]?.("io client disconnect");
    }),
    on: jest.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handler;
    }),
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

const flushAsync = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

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
    expect(events).toContainEqual({ type: "board", board: { ...board, players: [] } });
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

    expect(events).toContainEqual({ type: "error", message: "Can't reach the server" });
    expect(joinsOn(socket)).toBe(2);
    expect(service.currentCode).toBe("AB12CD");
  });

  test("a re-read that throws synchronously is reported and the room is still re-joined", async () => {
    const socket = makeFakeSocket();
    const getScoreboard = jest.fn(() => {
      throw new Error('Cannot build a request URL from "\\ud800"');
    });
    const { service, events } = build(socket, makeApi({ getScoreboard }));
    await service.joinScoreboard("AB12CD");

    fireDisconnect(socket);
    fireConnect(socket);
    await flushAsync();

    expect(events).toContainEqual({
      type: "error",
      message: 'Cannot build a request URL from "\\ud800"',
    });
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
    fireConnect(socket);
    await service.leaveScoreboard();

    const stale: Scoreboard = { ...board, players: [{ id: 1, name: "Amir", score: 7 }] };
    reRead.resolve(stale);
    await flushAsync();

    expect(service.currentCode).toBeNull();
    expect(events).not.toContainEqual({ type: "board", board: stale });
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
    fireConnect(first);
    await service.joinScoreboard("ZZ99YY");

    const stale: Scoreboard = { ...board, players: [{ id: 1, name: "Amir", score: 7 }] };
    reRead.resolve(stale);
    await flushAsync();

    expect(service.currentCode).toBe("ZZ99YY");
    expect(joinsOn(first)).toBe(1);
    expect(joinsOn(second)).toBe(1);
    expect(events).not.toContainEqual({ type: "board", board: stale });

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
    service.subscribe(listener);
    fireUpdate(socket, at(12));
    service.subscribe(listener);
    fireUpdate(socket, at(16));

    expect(seen).toEqual([
      { type: "board", board: at(4) },
      { type: "board", board: at(12) },
      { type: "board", board: at(16) },
    ]);
  });
});

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

    fireDisconnect(socket);
    fireConnect(socket);
    jest.advanceTimersByTime(1000);

    expect(socket.connect).not.toHaveBeenCalled();
  });

  test("a backoff timer armed before leaving does not outlive the board", async () => {
    const first = makeFakeSocket();
    const second = makeFakeSocket();
    const { service } = buildSockets([first, second], makeApi(), [1000]);
    await service.joinScoreboard("AB12CD");

    fireDisconnect(first);
    await service.leaveScoreboard();
    await service.joinScoreboard("ZZ99YY");

    jest.advanceTimersByTime(1000);

    expect(first.connect).not.toHaveBeenCalled();
    expect(second.connect).not.toHaveBeenCalled();
  });
});
