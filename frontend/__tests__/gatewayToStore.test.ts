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
  ownerId: "user_owner",
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

const actionsFor = (event: ServiceEvent): UnknownAction[] => {
  switch (event.type) {
    case "status":
      return [setStatus(event.status)];
    case "board":
      return [applyBoard(event.board)];
    case "error":
      return [setError(event.message)];
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

const settleMicrotasks = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

describe("a connection that fails", () => {
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
    expect(store.getState().scoreboard.current).toEqual(board);
  });
});
