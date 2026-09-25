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
  });
});
