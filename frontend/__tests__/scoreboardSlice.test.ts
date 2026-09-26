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
});
