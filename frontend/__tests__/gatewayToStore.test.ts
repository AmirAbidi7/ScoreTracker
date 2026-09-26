/// <reference types="jest" />
import { configureStore } from "@reduxjs/toolkit";
import type { UnknownAction } from "@reduxjs/toolkit";
import type { ApiClient } from "../infrastructure/api/client";
import type { SocketLike } from "../infrastructure/socket/scoreboardSocket";
import {
  ScoreboardService,
  type ServiceEvent,
} from "../src/features/scoreTracking/domain/ScoreboardService";
import type { Scoreboard } from "../src/features/scoreTracking/domain/Scoreboard";
import reducer, {
  applyBoard,
  resetScoreboard,
  setError,
  setStatus,
} from "../src/features/scoreTracking/scoreTrackingSlice";

/**
 * The gateway to the store, end to end: the real `ScoreboardService`, a fake
 * socket under it, and the real reducer. Nothing in between is stubbed.
 *
 * This exists because everything either side of it was already tested and the
 * seam between them was not. Both existing suites mock the other half — the page
 * and hook tests replace the service with an object whose `subscribe` is a
 * no-op, and the service tests collect events in an array — so "the first
 * connection failure is reported" could pass against a service that emitted the
 * reason and a reducer that erased it in the same tick. Neither end was wrong
 * and the message was lost.
 */

/** See `scoreboardService.test.ts`: the `any` here is the handler's own shape. */
type Handlers = Record<string, (...args: any[]) => void>;

type FakeSocket = SocketLike & {
  handlers: Handlers;
  connect: jest.Mock;
  disconnect: jest.Mock;
  off: jest.Mock;
};

const makeFakeSocket = (): FakeSocket => {
  const handlers: Handlers = {};
  const socket: FakeSocket = {
    connected: true,
    connect: jest.fn(),
    disconnect: jest.fn(),
    on: jest.fn((event: string, handler: (...args: any[]) => void) => {
      handlers[event] = handler;
    }),
    off: jest.fn((event: string, handler?: (...args: any[]) => void) => {
      if (handler && handlers[event] === handler) delete handlers[event];
    }),
    emit: jest.fn(),
    handlers,
  };
  return socket;
};

const board: Scoreboard = {
  id: "board-1",
  gameName: "Catan",
  code: "AB12CD",
  players: [{ id: 1, name: "Amir", score: 3 }],
  updateTime: "2026-09-25T10:00:00.000Z",
};

const makeApi = (overrides: Partial<Record<string, jest.Mock>> = {}) =>
  ({
    createScoreboard: jest.fn().mockResolvedValue(board),
    joinScoreboard: jest.fn().mockResolvedValue(board),
    getScoreboard: jest.fn().mockResolvedValue(board),
    listScoreboards: jest.fn().mockResolvedValue([board]),
    deleteScoreboard: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as ApiClient;

/**
 * The store half of `useScoreboardSync`'s listener, copied rather than shared.
 *
 * The hook cannot be the thing under test here: it subscribes to the module
 * singleton, whose socket is created by the real `createSocket`, so driving a
 * connection failure through it would mean a real connection attempt. Copying
 * the mapping keeps the production path untouched, and the `never` in the
 * default arm means this stops compiling if `ServiceEvent` grows an arm the hook
 * has to handle and this has not caught up.
 */
const actionsFor = (event: ServiceEvent): UnknownAction[] => {
  switch (event.type) {
    case "status":
      return [setStatus(event.status)];
    case "board":
      return [applyBoard(event.board)];
    case "error":
      return [setError(event.message)];
    // The hook also clears the saved session and navigates; the store half of
    // that is the reset, and the other two have their own tests.
    case "disconnected":
      return [resetScoreboard()];
    default: {
      const unhandled: never = event;
      throw new Error(`unhandled service event: ${JSON.stringify(unhandled)}`);
    }
  }
};

const makeStore = () => configureStore({ reducer: { scoreboard: reducer } });
type TestStore = ReturnType<typeof makeStore>;

/** A service wired to one fake socket, with every event pushed into `store`. */
const openServices: ScoreboardService[] = [];

const build = (socket: FakeSocket, store: TestStore, api = makeApi()) => {
  const service = new ScoreboardService({
    apiClient: api,
    createSocket: () => socket,
    reconnectDelays: [50_000],
  });
  openServices.push(service);
  service.subscribe((event) => {
    actionsFor(event).forEach((action) => {
      store.dispatch(action);
    });
  });
  return service;
};

afterEach(() => {
  // Every failure arms a retry timer, and jest will not exit while one is
  // pending. Leaving tears the service down, which is what clears it.
  openServices.splice(0).forEach((service) => {
    void service.leaveScoreboard();
  });
});

const fireConnectError = (socket: FakeSocket, message: string): void => {
  (socket.handlers["connect_error"] as (error: Error) => void)(new Error(message));
};

const fireConnect = (socket: FakeSocket): void => {
  (socket.handlers["connect"] as () => void)();
};

/** One macrotask, which is enough for the re-read's promise chain to settle. */
const settleMicrotasks = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe("a connection that fails", () => {
  /**
   * The finding, in one test: the *first* failure used to be reported and then
   * erased inside the same tick, so nothing reached the screen. The reason the
   * second failure survived was incidental — a retry was already armed, so
   * `scheduleReconnect` emitted no status for `setStatus` to clear the error
   * with — and the first one, the one a user is most likely to see, was the one
   * that vanished.
   */
  it("puts the first failure's reason in the store", async () => {
    const socket = makeFakeSocket();
    const store = makeStore();
    const service = build(socket, store);

    await service.joinScoreboard("AB12CD");
    expect(store.getState().scoreboard.status).toBe("connected");
    expect(store.getState().scoreboard.error).toBeNull();

    fireConnectError(socket, "xhr poll error");

    expect(store.getState().scoreboard.status).toBe("reconnecting");
    expect(store.getState().scoreboard.error).toBe("xhr poll error");
  });

  /**
   * The connection is also down, so both facts are on screen: the status is the
   * banner's business and `error` is the reason's, and neither replaces the
   * other.
   */
  it("keeps reporting each later failure, and keeps the status alongside it", async () => {
    const socket = makeFakeSocket();
    const store = makeStore();
    const service = build(socket, store);

    await service.joinScoreboard("AB12CD");
    fireConnectError(socket, "xhr poll error");
    fireConnectError(socket, "websocket error");

    expect(store.getState().scoreboard.error).toBe("websocket error");
    expect(store.getState().scoreboard.status).toBe("reconnecting");
  });

  /**
   * `setStatus` clearing `error` is deliberate — a connection that came up is
   * newer news than a failure that has stopped being true — so this is the other
   * half of the fix: the error survives until a status change means it, and is
   * not left stuck on screen after a successful reconnect.
   */
  it("takes the reason away once the connection comes back", async () => {
    const socket = makeFakeSocket();
    const store = makeStore();
    const service = build(socket, store);

    await service.joinScoreboard("AB12CD");
    fireConnectError(socket, "xhr poll error");
    expect(store.getState().scoreboard.error).toBe("xhr poll error");

    fireConnect(socket);
    await settleMicrotasks();

    expect(store.getState().scoreboard.status).toBe("connected");
    expect(store.getState().scoreboard.error).toBeNull();
    // The board survived the outage: it was re-read and is still on screen.
    expect(store.getState().scoreboard.current).toEqual(board);
  });
});
