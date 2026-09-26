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
   * A *different* board is a switch, not a late delivery, and its timestamp says
   * nothing about the board it replaces. This is the leaderboard path: joining a
   * game that was created before the one already on screen. Guarding on
   * `updateTime` alone left the previous game on the screen while the gateway
   * had already moved to the new one, and because player ids restart at 1 per
   * board the ids collided — `sendIntent` then credited the old game's player to
   * the new game's board and it *looked* like it worked.
   */
  test("a different board replaces the current one however old its timestamp is", () => {
    const olderGame: Scoreboard = {
      id: "b2",
      gameName: "Catan",
      code: "ZZ99YY",
      // The colliding id is the point: id 1 is a different person on this board.
      players: [{ id: 1, name: "Bo", score: 12 }],
      updateTime: "2026-09-01T00:00:00.000Z",
    };

    const withGame = reducer(initial, applyBoard(board));
    expect(reducer(withGame, applyBoard(olderGame)).current).toEqual(olderGame);
  });

  /** And back again, because a switch that only works one way is still a trap. */
  test("switching back to the first board applies it too", () => {
    const secondGame: Scoreboard = {
      id: "b2",
      gameName: "Catan",
      code: "ZZ99YY",
      players: [{ id: 1, name: "Bo", score: 12 }],
      updateTime: "2026-09-26T10:00:00.000Z",
    };

    const away = reducer(reducer(initial, applyBoard(board)), applyBoard(secondGame));
    expect(away.current).toEqual(secondGame);

    // Back to the first game, whose timestamp is now the older of the two.
    expect(reducer(away, applyBoard(board)).current).toEqual(board);
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

  /**
   * The real shape for a thunk that rejects with a falsy value: `payload` is the
   * empty string, and RTK has put its own placeholder on `error.message` because
   * there was no message to serialise. Storing either would show the user the
   * word "Rejected", or a blank red banner — both worse than showing nothing.
   */
  test("a rejection with nothing to say is not answered with a placeholder", () => {
    const rejected = {
      type: "scoreboard/intent/rejected",
      payload: "",
      error: { message: "Rejected" },
      meta: { rejectedWithValue: true, requestId: "request-4", arg: undefined },
    };
    expect(reducer(initial, rejected).error).toBeNull();
  });

  test("a rejection with nothing to say leaves the previous error alone", () => {
    const silent = { type: "scoreboard/intent/rejected", payload: undefined, meta: {} };
    const withError = reducer(initial, setError("boom"));
    expect(reducer(withError, silent).error).toBe("boom");
  });

  /**
   * The other half of a reported failure: it has to stop being reported once it
   * stops being true. Nothing else clears `error` between two intents — the
   * gateway reports a status only on connect, reconnect and disconnect — so
   * without this a stale refusal sits on the board while a later `+` works.
   */
  test("a later intent that goes through clears the refusal", () => {
    const refused = sendIntent.rejected(
      new Error("No such player"),
      "request-5",
      { type: "addScore", playerId: 1, amount: 2 },
    );
    const afterRefusal = reducer(reducer(initial, applyBoard(board)), refused);
    expect(afterRefusal.error).toBe("No such player");

    const accepted = sendIntent.fulfilled(
      later,
      "request-6",
      { type: "addScore", playerId: 1, amount: 2 },
    );
    const afterSuccess = reducer(afterRefusal, accepted);

    expect(afterSuccess.error).toBeNull();
    // The board does not travel on the fulfilled action: `sendIntent` dispatches
    // `applyBoard` with the server's board before it resolves, and `applyBoard`'s
    // ordering guard is what decides whether that board is newer. The case here
    // only forgets the failure.
    expect(afterSuccess.current).toEqual(board);
    expect(reducer(afterSuccess, applyBoard(later)).current).toEqual(later);
  });

  test("a successful delete needs no case of its own to clear the error", () => {
    // `deleteCurrentScoreboard` resets the board away on the way out, and the
    // reset nulls `error`. Asserted here so a future `delete/fulfilled` case is
    // recognised as redundant rather than added.
    const refused = deleteCurrentScoreboard.rejected(
      new Error("Bad gateway"),
      "request-7",
      undefined,
    );
    const afterRefusal = reducer(reducer(initial, applyBoard(board)), refused);
    expect(afterRefusal.error).toBe("Bad gateway");

    const deleted = reducer(
      afterRefusal,
      deleteCurrentScoreboard.fulfilled(undefined, "request-8", undefined),
    );
    expect(reducer(deleted, resetScoreboard()).error).toBeNull();
  });

  test("a rejection is cleared by the next status change, like any other error", () => {
    const withError = reducer(initial, setError("boom"));
    expect(reducer(withError, setStatus("connected")).error).toBeNull();
  });
});
