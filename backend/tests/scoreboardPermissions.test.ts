import { describe, expect, test } from "bun:test";
import { Effect, Result } from "effect";
import type { Db } from "../config/db";
import type { Player } from "../models/Scoreboard";
import { applyIntentToCode } from "../service/scoreboardIntentService";
import { deleteScoreboard } from "../service/scoreboardService";

type Row = {
  id: string;
  gameName: string;
  code: string;
  players: Player[];
  updateTime: Date;
  ownerId: string | null;
};

const board = (overrides: Partial<Row> = {}): Row => ({
  id: "11111111-1111-1111-1111-111111111111",
  gameName: "Catan",
  code: "AB12CD",
  players: [{ id: 1, name: "Amir", score: 0 }],
  updateTime: new Date("2026-09-25T10:00:00.000Z"),
  ownerId: "user_owner",
  ...overrides,
});

const makeFakeDb = (initial: Row | null) => {
  let stored = initial ? { ...initial } : null;

  const db = {
    select: () => ({
      from: () => ({
        where: () =>
          Promise.resolve<Row[]>(stored ? [{ ...stored, players: [...stored.players] }] : []),
      }),
    }),
    update: () => ({
      set: (values: Partial<Row>) => ({
        where: () => ({
          returning: () => {
            if (!stored) return Promise.resolve<Row[]>([]);
            stored = { ...stored, ...values };
            return Promise.resolve<Row[]>([{ ...stored }]);
          },
        }),
      }),
    }),
    delete: () => ({
      where: () => ({
        returning: () => {
          if (!stored) return Promise.resolve<Row[]>([]);
          const removed = { ...stored, code: stored.code };
          stored = null;
          return Promise.resolve<Row[]>([removed]);
        },
      }),
    }),
  };

  return { db: db as unknown as Db, row: () => stored };
};

const tagOf = async <A, E>(eff: Effect.Effect<A, E>): Promise<string> => {
  const result = await Effect.runPromise(Effect.result(eff));
  if (Result.isSuccess(result)) throw new Error("expected the effect to fail");
  return (result.failure as { _tag: string })._tag;
};

describe("auth: permission matrix for intents", () => {
  test("signed-out intent is refused as unauthorized", async () => {
    const fake = makeFakeDb(board());
    expect(await tagOf(applyIntentToCode(fake.db)("AB12CD", { type: "addPlayer", name: "Bo" }, null))).toBe(
      "UnauthorizedError",
    );
    expect(fake.row()?.players).toHaveLength(1);
  });

  test("signed-in intent on an ownerless board is refused until claimed", async () => {
    const fake = makeFakeDb(board({ ownerId: null }));
    expect(
      await tagOf(applyIntentToCode(fake.db)("AB12CD", { type: "addPlayer", name: "Bo" }, "user_abc")),
    ).toBe("ForbiddenError");
    expect(fake.row()?.players).toHaveLength(1);
  });

  test("signed-in joiner edits an owned board", async () => {
    const fake = makeFakeDb(board());
    const result = await Effect.runPromise(
      Effect.result(
        applyIntentToCode(fake.db)("AB12CD", { type: "addPlayer", name: "Bo" }, "user_joiner"),
      ),
    );
    if (Result.isFailure(result)) throw new Error(`intent failed: ${String(result.failure)}`);
    expect(result.success.players).toEqual([
      { id: 1, name: "Amir", score: 0 },
      { id: 2, name: "Bo", score: 0 },
    ]);
  });

  test("owner edits an owned board", async () => {
    const fake = makeFakeDb(board());
    const result = await Effect.runPromise(
      Effect.result(
        applyIntentToCode(fake.db)(
          "AB12CD",
          { type: "addScore", playerId: 1, amount: 3 },
          "user_owner",
        ),
      ),
    );
    if (Result.isFailure(result)) throw new Error(`intent failed: ${String(result.failure)}`);
    expect(result.success.players[0]?.score).toBe(3);
  });
});

describe("auth: permission matrix for delete", () => {
  test("signed-out delete is refused as unauthorized", async () => {
    const fake = makeFakeDb(board());
    expect(await tagOf(deleteScoreboard(fake.db)("11111111-1111-1111-1111-111111111111", null))).toBe(
      "UnauthorizedError",
    );
    expect(fake.row()).not.toBeNull();
  });

  test("ownerless board cannot be deleted until claimed", async () => {
    const fake = makeFakeDb(board({ ownerId: null }));
    expect(
      await tagOf(deleteScoreboard(fake.db)("11111111-1111-1111-1111-111111111111", "user_abc")),
    ).toBe("ForbiddenError");
    expect(fake.row()).not.toBeNull();
  });

  test("non-owner delete is refused", async () => {
    const fake = makeFakeDb(board());
    expect(
      await tagOf(deleteScoreboard(fake.db)("11111111-1111-1111-1111-111111111111", "user_other")),
    ).toBe("ForbiddenError");
    expect(fake.row()).not.toBeNull();
  });

  test("owner delete succeeds", async () => {
    const fake = makeFakeDb(board());
    const result = await Effect.runPromise(
      Effect.result(deleteScoreboard(fake.db)("11111111-1111-1111-1111-111111111111", "user_owner")),
    );
    if (Result.isFailure(result)) throw new Error(`delete failed: ${String(result.failure)}`);
    expect(result.success).toBe("AB12CD");
    expect(fake.row()).toBeNull();
  });
});
