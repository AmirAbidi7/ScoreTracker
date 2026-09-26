import { describe, expect, test } from "bun:test";
import { Effect, Result } from "effect";
import { parseIntent } from "../dto/ScoreboardIntent";
import { applyIntent } from "../service/scoreboardIntentService";
import type { ScoreboardDTO } from "../dto/ScoreboardDTO";

const board = (players: { id: number; name: string; score: number }[] = []): ScoreboardDTO => ({
  id: "11111111-1111-1111-1111-111111111111",
  gameName: "Catan",
  code: "AB12CD",
  players,
  updateTime: "2026-09-25T10:00:00.000Z",
});

const run = <A, E>(eff: Effect.Effect<A, E>) => Effect.runPromise(Effect.result(eff));

describe("applyIntent", () => {
  test("addScore increments the named player and leaves others alone", async () => {
    const result = await run(
      applyIntent(
        board([
          { id: 1, name: "Amir", score: 20 },
          { id: 2, name: "Dolly", score: 10 },
        ]),
        { type: "addScore", playerId: 2, amount: 5 },
      ),
    );
    expect(Result.isSuccess(result) && result.success.players).toEqual([
      { id: 1, name: "Amir", score: 20 },
      { id: 2, name: "Dolly", score: 15 },
    ]);
  });

  test("addScore leaves the scoreboard identity untouched", async () => {
    const result = await run(
      applyIntent(board([{ id: 1, name: "Amir", score: 20 }]), {
        type: "addScore",
        playerId: 1,
        amount: 5,
      }),
    );
    expect(Result.isSuccess(result) && result.success).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      gameName: "Catan",
      code: "AB12CD",
      players: [{ id: 1, name: "Amir", score: 25 }],
      updateTime: "2026-09-25T10:00:00.000Z",
    });
  });

  test("addScore accepts a negative amount", async () => {
    const result = await run(
      applyIntent(board([{ id: 1, name: "Amir", score: 20 }]), {
        type: "addScore",
        playerId: 1,
        amount: -7,
      }),
    );
    expect(Result.isSuccess(result) && result.success.players[0]?.score).toBe(13);
  });

  test("addScore on a player who no longer exists is rejected", async () => {
    const result = await run(
      applyIntent(board([{ id: 1, name: "Amir", score: 20 }]), {
        type: "addScore",
        playerId: 99,
        amount: 5,
      }),
    );
    expect(Result.isFailure(result)).toBe(true);
  });

  test("addPlayer appends with the next id after the highest, not the last", async () => {
    const result = await run(
      applyIntent(
        board([
          { id: 4, name: "Sally", score: 1 },
          { id: 2, name: "Dolly", score: 2 },
        ]),
        { type: "addPlayer", name: "  Bryan  " },
      ),
    );
    expect(Result.isSuccess(result) && result.success.players).toEqual([
      { id: 4, name: "Sally", score: 1 },
      { id: 2, name: "Dolly", score: 2 },
      { id: 5, name: "Bryan", score: 0 },
    ]);
  });

  test("addPlayer on an empty board starts ids at 1", async () => {
    const result = await run(applyIntent(board(), { type: "addPlayer", name: "Amir" }));
    expect(Result.isSuccess(result) && result.success.players).toEqual([
      { id: 1, name: "Amir", score: 0 },
    ]);
  });

  test("addPlayer rejects a blank name", async () => {
    const result = await run(applyIntent(board(), { type: "addPlayer", name: "   " }));
    expect(Result.isFailure(result)).toBe(true);
  });

  test("removePlayer filters the player out", async () => {
    const result = await run(
      applyIntent(
        board([
          { id: 1, name: "Amir", score: 20 },
          { id: 2, name: "Dolly", score: 10 },
        ]),
        { type: "removePlayer", playerId: 1 },
      ),
    );
    expect(Result.isSuccess(result) && result.success.players).toEqual([
      { id: 2, name: "Dolly", score: 10 },
    ]);
  });

  test("removePlayer on a player who no longer exists is rejected", async () => {
    const result = await run(
      applyIntent(board([{ id: 1, name: "Amir", score: 20 }]), {
        type: "removePlayer",
        playerId: 42,
      }),
    );
    expect(Result.isFailure(result)).toBe(true);
  });

  test("applyIntent does not mutate its input", async () => {
    const input = board([{ id: 1, name: "Amir", score: 20 }]);
    const snapshot = JSON.stringify(input);
    await run(applyIntent(input, { type: "addScore", playerId: 1, amount: 5 }));
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("parseIntent", () => {
  test("accepts each well-formed intent", () => {
    expect(parseIntent({ type: "addScore", playerId: 1, amount: 2 })).toEqual({
      type: "addScore",
      playerId: 1,
      amount: 2,
    });
    expect(parseIntent({ type: "addPlayer", name: "Amir" })).toEqual({
      type: "addPlayer",
      name: "Amir",
    });
    expect(parseIntent({ type: "removePlayer", playerId: 1 })).toEqual({
      type: "removePlayer",
      playerId: 1,
    });
  });

  test("rejects null, undefined, and non-objects", () => {
    expect(parseIntent(null)).toBeNull();
    expect(parseIntent(undefined)).toBeNull();
    expect(parseIntent("addScore")).toBeNull();
    expect(parseIntent(7)).toBeNull();
  });

  test("rejects an unknown type", () => {
    expect(parseIntent({ type: "setScore", playerId: 1, score: 999 })).toBeNull();
  });

  test("rejects wrong field types", () => {
    expect(parseIntent({ type: "addScore", playerId: "1", amount: 2 })).toBeNull();
    expect(parseIntent({ type: "addScore", playerId: 1, amount: "2" })).toBeNull();
    expect(parseIntent({ type: "addPlayer", name: 42 })).toBeNull();
    expect(parseIntent({ type: "removePlayer" })).toBeNull();
  });

  test("rejects NaN and non-finite amounts", () => {
    expect(parseIntent({ type: "addScore", playerId: 1, amount: NaN })).toBeNull();
    expect(parseIntent({ type: "addScore", playerId: 1, amount: Infinity })).toBeNull();
    expect(parseIntent({ type: "addScore", playerId: 1, amount: -Infinity })).toBeNull();
  });

  /**
   * "Finite" was never enough. `1e308` passes every check a UI that enables its
   * button on `isFinite` would make, and two of them make the score `Infinity` —
   * which `JSON.stringify` writes into the jsonb column as `null`. After that
   * every client renders a blank score and `b.score - a.score` is `NaN`, so the
   * ranking is gone as well as the score, and nothing the client can send will
   * bring it back.
   *
   * `2.5` and `-2.5` are the same defect in miniature: a score that is not an
   * integer is not a score, and `p.score + p.score` drifts immediately.
   */
  test.each([
    ["a magnitude that overflows a double", 1e308],
    ["the negative of one", -1e308],
    ["one past the largest exact integer", Number.MAX_SAFE_INTEGER + 1],
    ["the largest exact integer", Number.MAX_SAFE_INTEGER],
    ["a fraction", 2.5],
    ["a negative fraction", -2.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("rejects an amount that is %s", (_label, amount) => {
    expect(parseIntent({ type: "addScore", playerId: 1, amount })).toBeNull();
  });

  /** A bound, not a ban: the largest amount a real board could plausibly need. */
  test.each([
    ["a million", 1_000_000],
    ["a million down", -1_000_000],
    ["one", 1],
    ["minus one", -1],
  ])("accepts %s", (label, amount) => {
    expect(parseIntent({ type: "addScore", playerId: 1, amount })).toEqual({
      type: "addScore",
      playerId: 1,
      amount,
    });
  });

  test("refuses the first amount past the bound, in either direction", () => {
    expect(parseIntent({ type: "addScore", playerId: 1, amount: 1_000_001 })).toBeNull();
    expect(parseIntent({ type: "addScore", playerId: 1, amount: -1_000_001 })).toBeNull();
  });

  /**
   * A `playerId` names a row, so `2.5` matches nothing and `1e308` could not name
   * one either. Rejecting the fraction here turns a 400 with a useful reason into
   * a 400 with "no player with id 2.5" — the difference between the client being
   * told its payload is malformed and being told its player does not exist.
   */
  test.each([
    ["a fraction", 2.5],
    ["a negative fraction", -2.5],
    ["a magnitude that overflows a double", 1e308],
    ["one past the largest exact integer", Number.MAX_SAFE_INTEGER + 1],
    ["NaN", Number.NaN],
  ])("rejects a playerId that is %s", (_label, playerId) => {
    expect(parseIntent({ type: "addScore", playerId, amount: 1 })).toBeNull();
    expect(parseIntent({ type: "removePlayer", playerId })).toBeNull();
  });
});
