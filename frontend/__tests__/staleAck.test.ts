/// <reference types="jest" />
import { configureStore } from "@reduxjs/toolkit";
import type { SocketLike } from "../infrastructure/socket/scoreboardSocket";
import type { Scoreboard } from "../src/features/scoreTracking/domain/Scoreboard";
import reducer from "../src/features/scoreTracking/scoreTrackingSlice";
import {
  joinScoreboard,
  sendIntent,
} from "../src/features/scoreTracking/scoreTrackingThunks";

/**
 * An ack that lands after the user has moved on to another game.
 *
 * The whole path is real except the two edges: the socket is a fake, because
 * socket.io-client cannot be made to hold an answer open on demand, and the REST
 * client is a fake, because there is no server. The `ScoreboardService` is the
 * real module singleton, the thunks are the real ones, and the store is the real
 * reducer — so the board on screen here is the board the app would be showing.
 *
 * Nothing in this file drives an ack into the store by hand. That is the point:
 * a test that maps the answer to `applyBoard` itself would be asserting its own
 * wiring, and the wiring is what is under suspicion.
 */

/**
 * The two edges, replaced at the module level so the real service picks them up
 * when it builds its socket. Names are `mock`-prefixed because `jest.mock` is
 * hoisted above the imports and the factory closes over them.
 */
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
  // Everything else is the real thing, including the 8s ack timeout: only the
  // socket's creation is ours, and it is what lets an ack be held open.
  return { ...actual, createSocket: () => mockNextSocket() };
});

/** `(...args: any[])` is the handler shape `SocketLike` declares; see its comment. */
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
    // The real client emits `disconnect` when it is disconnected locally, and the
    // service does exactly that on every teardown. A fake that swallowed it would
    // hide a reconnect scheduled for a socket the app has thrown away.
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
/** The sockets the service has actually asked for, in the order it asked. */
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
  // Player id 1 on both boards, deliberately: the whole failure is that a
  // `playerId` means nothing without the board it belongs to.
  players: [{ id: 1, name: "Amir", score: 0 }],
  updateTime: "2026-09-25T10:00:00.000Z",
};

const boardB: Scoreboard = {
  id: "board-b",
  gameName: "Chess",
  code: "ZZ99YY",
  players: [{ id: 1, name: "Bo", score: 5 }],
  // Newer than the answer below, so this is the ordering the pre-fix timestamp
  // guard happened to catch — the accident, not a rule. An older board would have
  // been just as broken before the id-based switch.
  updateTime: "2026-09-25T10:05:00.000Z",
};

/** The server's answer to a `+1` on A: applied there, and nowhere else. */
const scoredA: Scoreboard = {
  ...boardA,
  players: [{ id: 1, name: "Amir", score: 1 }],
  updateTime: "2026-09-25T10:00:01.000Z",
};

const makeStore = () => configureStore({ reducer: { scoreboard: reducer } });
type TestStore = ReturnType<typeof makeStore>;

/** The `+1` tap on A, with the server's answer held open. */
const tapOnA = (store: TestStore) => {
  const pending = store.dispatch(sendIntent({ type: "addScore", playerId: 1, amount: 1 }));
  const first = mockCreated[0];
  if (!first) throw new Error("the service never opened a socket for A");
  const emitted = first.emitted.find((e) => e.event === "scoreboard:intent");
  if (!emitted) throw new Error("the intent was never emitted");
  // Where it went, asserted so the test cannot pass with the wrong board in play.
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
  // `clearAllMocks`, never `resetAllMocks`: the AsyncStorage mock the setup file
  // installs is built from shared `jest.fn()`s, and resetting strips their
  // implementations, so the session write the thunks do would start failing.
  jest.clearAllMocks();
  mockSockets = [makeFakeSocket(), makeFakeSocket()];
  mockCreated = [];
  apiClient.joinScoreboard.mockReset().mockResolvedValueOnce(boardA).mockResolvedValue(boardB);
  apiClient.getScoreboard.mockReset().mockResolvedValue(boardB);
});

describe("an answer that arrives after the user has switched games", () => {
  /**
   * The regression. `teardown` detaches the old socket's listeners and
   * disconnects it, but it cannot un-send an intent: the server may still answer
   * one for the game the user has just left.
   *
   * That answer is a board with a different id, and `applyBoard` switches on a
   * differing id — which is right for a deliberate switch and wrong here. The
   * store went back to A while `current` was B, so the next tap posted A's
   * `playerId` to B's `code`; ids restart at 1 per board, so the ids collided,
   * the write succeeded, and the wrong score moved convincingly.
   */
  it("leaves the store on the game the user switched to", async () => {
    const store = makeStore();
    await store.dispatch(joinScoreboard("AB12CD"));
    expect(store.getState().scoreboard.current).toEqual(boardA);

    const { pending, answer } = tapOnA(store);

    // The switch completes inside the ack's round trip.
    await store.dispatch(joinScoreboard("ZZ99YY"));
    expect(store.getState().scoreboard.current).toEqual(boardB);
    // And the old socket really was dropped, so this is the abandoned-ack case
    // rather than a second live connection.
    expect(Object.keys(mockCreated[0].handlers)).toEqual([]);

    answer({ ok: true, scoreboard: scoredA });
    const settled = await pending;

    // Still B. A's score went to A, which nobody is looking at any more.
    expect(store.getState().scoreboard.current).toEqual(boardB);
    expect(store.getState().scoreboard.current?.players[0]?.score).toBe(5);
    // The intent settled rather than hanging, and was not reported as a failure:
    // nothing failed on the game in front of the user.
    expect(sendIntent.fulfilled.match(settled)).toBe(true);
    expect(store.getState().scoreboard.pendingIntents).toBe(0);
    expect(store.getState().scoreboard.error).toBeNull();
  });

  /**
   * The other half of the rule, and the asymmetry is deliberate. A refusal
   * carries no board, so it cannot be applied to the wrong one by mistake, and
   * suppressing it would throw away a real answer about a game the user may well
   * switch back to. Only the board is gated.
   */
  it("still reports a refusal for a game the user has left", async () => {
    const store = makeStore();
    await store.dispatch(joinScoreboard("AB12CD"));

    const { pending, answer } = tapOnA(store);
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
