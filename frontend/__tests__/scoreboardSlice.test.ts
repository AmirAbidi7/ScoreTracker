/// <reference types="jest" />
import reducer, {
  applyBoard,
  intentSettled,
  intentStarted,
  resetScoreboard,
  setBoards,
  setBoardsStatus,
  setError,
  setStatus,
} from "../src/features/scoreTracking/scoreTrackingSlice";
import type { Scoreboard } from "../src/features/scoreTracking/domain/Scoreboard";
import {
  deleteCurrentScoreboard,
  sendIntent,
} from "../src/features/scoreTracking/scoreTrackingThunks";

/**
 * The gateway is mocked wholesale, as in the thunks' own tests: this file is
 * about the reducer, and the slice must be importable without a socket.
 */
jest.mock("../src/features/scoreTracking/domain/ScoreboardService", () => ({
  scoreboardService: {
    joinScoreboard: jest.fn(),
    createScoreboard: jest.fn(),
    listScoreboards: jest.fn(),
    leaveScoreboard: jest.fn(),
    deleteCurrentScoreboard: jest.fn(),
    sendIntent: jest.fn(),
    subscribe: jest.fn(() => () => {}),
  },
}));

const board: Scoreboard = {
  id: "b1",
  gameName: "Catan",
  code: "AB12CD",
  players: [{ id: 1, name: "Amir", score: 3 }],
  updateTime: "2026-09-25T10:00:00.000Z",
};

const later: Scoreboard = {
  ...board,
  players: [{ id: 1, name: "Amir", score: 8 }],
  updateTime: "2026-09-25T10:00:01.000Z",
};

const initial = reducer(undefined, { type: "@@INIT" });

describe("scoreboardSlice", () => {
  test("starts with no board", () => {
    expect(initial.current).toBeNull();
    expect(initial.status).toBe("idle");
    expect(initial.error).toBeNull();
    expect(initial.pendingIntents).toBe(0);
    expect(initial.boards).toEqual([]);
    expect(initial.boardsStatus).toBe("idle");
  });

  test("applyBoard sets the first board received", () => {
    const next = reducer(initial, applyBoard(board));
    expect(next.current).toEqual(board);
  });

  test("applyBoard ignores a board that is not strictly newer", () => {
    const afterFirst = reducer(initial, applyBoard(later));
    const afterStale = reducer(afterFirst, applyBoard(board));
    expect(afterStale.current).toEqual(later);
  });

  test("applyBoard ignores a board with an identical timestamp", () => {
    const afterFirst = reducer(initial, applyBoard(board));
    const tie = { ...board, players: [{ id: 1, name: "Amir", score: 999 }] };
    const afterTie = reducer(afterFirst, applyBoard(tie));
    expect(afterTie.current).toEqual(board);
  });

  test("applyBoard accepts a newer board", () => {
    const afterFirst = reducer(initial, applyBoard(board));
    const afterLater = reducer(afterFirst, applyBoard(later));
    expect(afterLater.current).toEqual(later);
  });

  /**
   * The gateway re-reads the board over REST on every `connect`, and
   * `enterBoard` has already emitted one, so the very first `board` event
   * arrives twice. The second delivery is a *different object* with the same
   * content — a second REST response, not the same reference — so this asserts
   * on the identity of the returned state: a `>=` comparison, or no
   * comparison at all, would assign the fresh payload, immer would see a
   * change, and every connected component would re-render for a board that
   * did not move.
   */
  test("a redelivered board leaves the state untouched", () => {
    const afterFirst = reducer(initial, applyBoard(board));
    const redelivered: Scoreboard = { ...board, players: [{ ...board.players[0] }] };
    const afterSecond = reducer(afterFirst, applyBoard(redelivered));
    expect(afterSecond).toBe(afterFirst);
    expect(afterSecond.current).toBe(afterFirst.current);
  });

  /**
   * The clamp is load-bearing: an intent that times out or is rejected can
   * settle without a matching start, and a negative counter renders as a
   * spinner that never goes away.
   */
  test("the pending counter rises and falls without going negative", () => {
    const one = reducer(initial, intentStarted());
    const two = reducer(one, intentStarted());
    expect(two.pendingIntents).toBe(2);
    expect(reducer(two, intentSettled()).pendingIntents).toBe(1);

    const settled = reducer(reducer(two, intentSettled()), intentSettled());
    expect(settled.pendingIntents).toBe(0);
    // A third settle has no start left to match.
    expect(reducer(settled, intentSettled()).pendingIntents).toBe(0);
  });

  /** The same clamp, reached from a store that never saw an intent start. */
  test("a settle with no matching start leaves the counter at zero", () => {
    const settled = reducer(initial, intentSettled());
    expect(settled.pendingIntents).toBe(0);
    expect(reducer(settled, intentSettled()).pendingIntents).toBe(0);
  });

  test("setError clears on the next status change", () => {
    const withError = reducer(initial, setError("boom"));
    expect(withError.error).toBe("boom");
    expect(reducer(withError, setStatus("connecting")).error).toBeNull();
  });

  test("setStatus records the status it is given", () => {
    expect(reducer(initial, setStatus("connected")).status).toBe("connected");
    expect(reducer(reducer(initial, setStatus("offline")), setStatus("idle")).status).toBe("idle");
  });

  test("boards are stored separately from the active board", () => {
    const next = reducer(initial, setBoards([board]));
    expect(next.boards).toEqual([board]);
    expect(next.current).toBeNull();
  });

  test("resetScoreboard clears the board but keeps the leaderboard list", () => {
    const withBoard = reducer(reducer(initial, setBoards([board])), applyBoard(board));
    const after = reducer(withBoard, resetScoreboard());
    expect(after.current).toBeNull();
    expect(after.status).toBe("idle");
    expect(after.boards).toEqual([board]);
  });

  test("resetScoreboard clears the transient state as well", () => {
    const busy = reducer(
      reducer(reducer(initial, applyBoard(board)), setStatus("connected")),
      setError("boom"),
    );
    const pending = reducer(busy, intentStarted());
    const after = reducer(pending, resetScoreboard());
    expect(after.error).toBeNull();
    expect(after.pendingIntents).toBe(0);
  });

  /**
   * `current` orders strictly by `updateTime`, so without a reset the store
   * could never hold a board older than the one it already has. Clearing
   * `current` is what makes leaving and joining another board possible.
   */
  test("a board can be applied again after a reset", () => {
    const switched = reducer(reducer(initial, applyBoard(later)), resetScoreboard());
    expect(reducer(switched, applyBoard(board)).current).toEqual(board);
  });

  test("boardsStatus is tracked independently", () => {
    expect(reducer(initial, setBoardsStatus("loading")).boardsStatus).toBe("loading");
    expect(reducer(initial, setBoardsStatus("ready")).boardsStatus).toBe("ready");
    expect(reducer(initial, setBoardsStatus("error")).boardsStatus).toBe("error");
  });

  /**
   * The two rejections are matched by their type strings, which the slice cannot
   * import from the thunks without a cycle. Dispatching the *real* creators here
   * is what keeps the strings honest: rename a thunk's prefix, or change what it
   * rejects with, and this fails instead of the app going silent on a refused
   * score change again.
   */
  test("a rejection the thunks raise is reported", () => {
    const rejected = sendIntent.rejected(
      new Error("No such player"),
      "request-1",
      { type: "addScore", playerId: 1, amount: 2 },
    );
    const next = reducer(reducer(initial, applyBoard(board)), rejected);
    expect(rejected.type).toBe("scoreboard/intent/rejected");
    expect(next.error).toBe("No such player");
    // Still the server's board: a refusal changes nothing about the score.
    expect(next.current).toEqual(board);
  });

  test("a failed delete is reported and keeps the board", () => {
    const rejected = deleteCurrentScoreboard.rejected(
      new Error("Bad gateway"),
      "request-2",
      undefined,
    );
    const next = reducer(reducer(initial, applyBoard(board)), rejected);
    expect(next.error).toBe("Bad gateway");
    expect(next.current).toEqual(board);
  });

  /**
   * The shape `rejectWithValue` produces, which is what every thunk in this app
   * actually does — so it is the one that has to be read, and it is not the
   * shape the `rejected` creator above builds.
   */
  test("a reason carried in the payload is reported", () => {
    const rejected = {
      type: "scoreboard/intent/rejected",
      payload: "No such player",
      meta: {
        arg: { type: "addScore", playerId: 1, amount: 2 },
        requestId: "request-3",
        rejectedWithValue: true,
        requestStatus: "rejected",
        aborted: false,
        condition: false,
      },
    };

    expect(reducer(initial, rejected).error).toBe("No such player");
  });

  test("a rejection with nothing to say leaves the previous error alone", () => {
    // An empty red banner is the same silence as no banner, so there is no
    // message and nothing is written.
    const silent = { type: "scoreboard/intent/rejected", payload: undefined, meta: {} };
    const withError = reducer(initial, setError("boom"));
    expect(reducer(withError, silent).error).toBe("boom");
  });

  test("a rejection is cleared by the next status change, like any other error", () => {
    const withError = reducer(initial, setError("boom"));
    expect(reducer(withError, setStatus("connected")).error).toBeNull();
  });
});
