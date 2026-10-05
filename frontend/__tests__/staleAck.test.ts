/// <reference types="jest" />
import { configureStore } from "@reduxjs/toolkit";
import type { SocketLike } from "../infrastructure/socket/scoreboardSocket";
import type { Scoreboard } from "../src/features/scoreTracking/domain/Scoreboard";
import reducer from "../src/features/scoreTracking/scoreTrackingSlice";
import {
  joinScoreboard,
  sendIntent,
} from "../src/features/scoreTracking/scoreTrackingThunks";

jest.mock("../infrastructure/api/client", () => {
  const actual = jest.requireActual("../infrastructure/api/client");
  return {
    ...actual,
    apiClient: {
      createScoreboard: jest.fn(),
      joinScoreboard: jest.fn(),
      getScoreboard: jest.fn(),
      listScoreboards: jest.fn(),
      deleteScoreboard: jest.fn(),
    },
  };
});

jest.mock("../infrastructure/socket/scoreboardSocket", () => {
  const actual = jest.requireActual("../infrastructure/socket/scoreboardSocket");
  return { ...actual, createSocket: () => mockNextSocket() };
});

type Handlers = Record<string, (...args: any[]) => void>;

type FakeSocket = SocketLike & {
  handlers: Handlers;
  emitted: { event: string; args: unknown[] }[];
  connect: jest.Mock;
  disconnect: jest.Mock;
  off: jest.Mock;
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

let mockSockets: FakeSocket[] = [];
let mockCreated: FakeSocket[] = [];

const mockNextSocket = (): SocketLike => {
  const next = mockSockets.shift();
  if (!next) throw new Error("the test supplied fewer sockets than the service asked for");
  mockCreated.push(next);
  return next;
};

const { apiClient } = jest.requireMock("../infrastructure/api/client") as {
  apiClient: Record<string, jest.Mock>;
};

const boardA: Scoreboard = {
  id: "board-a",
  gameName: "Catan",
  code: "AB12CD",
  players: [{ id: 1, name: "Amir", score: 0 }],
  updateTime: "2026-09-25T10:00:00.000Z",
  ownerId: "user_owner",
};

const boardB: Scoreboard = {
  id: "board-b",
  gameName: "Chess",
  code: "ZZ99YY",
  players: [{ id: 1, name: "Bo", score: 5 }],
  updateTime: "2026-09-25T10:05:00.000Z",
  ownerId: "user_owner",
};

const scoredA: Scoreboard = {
  ...boardA,
  players: [{ id: 1, name: "Amir", score: 1 }],
  updateTime: "2026-09-25T10:00:01.000Z",
  ownerId: "user_owner",
};

const makeStore = () => configureStore({ reducer: { scoreboard: reducer } });
type TestStore = ReturnType<typeof makeStore>;

const tapOnA = async (store: TestStore) => {
  const pending = store.dispatch(sendIntent({ type: "addScore", playerId: 1, amount: 1 }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const first = mockCreated[0];
  if (!first) throw new Error("the service never opened a socket for A");
  const emitted = first.emitted.find((e) => e.event === "scoreboard:intent");
  if (!emitted) throw new Error("the intent was never emitted");
  expect(emitted.args[0]).toEqual({
    code: "AB12CD",
    intent: { type: "addScore", playerId: 1, amount: 1 },
  });
  return {
    pending,
    answer: (ack: unknown) => (emitted.args[1] as (a: unknown) => void)(ack),
  };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockSockets = [makeFakeSocket(), makeFakeSocket()];
  mockCreated = [];
  apiClient.joinScoreboard.mockReset().mockResolvedValueOnce(boardA).mockResolvedValue(boardB);
  apiClient.getScoreboard.mockReset().mockResolvedValue(boardB);
});

describe("an answer that arrives after the user has switched games", () => {
  it("leaves the store on the game the user switched to", async () => {
    const store = makeStore();
    await store.dispatch(joinScoreboard("AB12CD"));
    expect(store.getState().scoreboard.current).toEqual(boardA);

    const { pending, answer } = await tapOnA(store);

    await store.dispatch(joinScoreboard("ZZ99YY"));
    expect(store.getState().scoreboard.current).toEqual(boardB);
    expect(Object.keys(mockCreated[0].handlers)).toEqual([]);

    answer({ ok: true, scoreboard: scoredA });
    const settled = await pending;

    expect(store.getState().scoreboard.current).toEqual(boardB);
    expect(store.getState().scoreboard.current?.players[0]?.score).toBe(5);
    expect(sendIntent.fulfilled.match(settled)).toBe(true);
    expect(store.getState().scoreboard.pendingIntents).toBe(0);
    expect(store.getState().scoreboard.error).toBeNull();
  });

  it("still reports a refusal for a game the user has left", async () => {
    const store = makeStore();
    await store.dispatch(joinScoreboard("AB12CD"));

    const { pending, answer } = await tapOnA(store);
    await store.dispatch(joinScoreboard("ZZ99YY"));

    answer({ ok: false, code: 400, message: "scoreboard board-a has no player with id 1" });
    const settled = await pending;

    expect(sendIntent.rejected.match(settled)).toBe(true);
    expect(store.getState().scoreboard.current).toEqual(boardB);
    expect(store.getState().scoreboard.error).toBe(
      "scoreboard board-a has no player with id 1",
    );
  });
});
