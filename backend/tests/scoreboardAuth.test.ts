import { describe, expect, test } from "bun:test";
import { Effect, Result } from "effect";
import type { Db } from "../config/db";
import type { ScoreboardCreateRequest } from "../dto/ScoreboardDTO";
import type { Player } from "../models/Scoreboard";
import { claimScoreboard, createScoreboard } from "../service/scoreboardService";

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
  players: [],
  updateTime: new Date("2026-09-25T10:00:00.000Z"),
  ownerId: null,
  ...overrides,
});

const makeFakeDb = (initial: Row | null) => {
  let stored = initial ? { ...initial } : null;
  const inserted: Row[] = [];

  const db = {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          const row = board({
            ...(stored ?? {}),
            ...(values as Partial<Row>),
            updateTime: new Date("2026-09-25T10:00:00.000Z"),
          });
          stored = row;
          inserted.push(row);
          return Promise.resolve<Row[]>([row]);
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => Promise.resolve<Row[]>(stored ? [{ ...stored }] : []),
      }),
    }),
    update: () => ({
      set: (values: Partial<Row>) => ({
        where: () => ({
          returning: () => {
            if (!stored) return Promise.resolve<Row[]>([]);
            if ("ownerId" in values && stored.ownerId !== null) {
              return Promise.resolve<Row[]>([]);
            }
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
          const removed = { ...stored };
          stored = null;
          return Promise.resolve<Row[]>([removed]);
        },
      }),
    }),
  };

  return { db: db as unknown as Db, inserted, row: () => stored };
};

const failureOf = async <A, E>(eff: Effect.Effect<A, E>): Promise<E> => {
  const result = await Effect.runPromise(Effect.result(eff));
  if (Result.isSuccess(result)) throw new Error("expected the effect to fail");
  return result.failure;
};

const successOf = async <A, E>(eff: Effect.Effect<A, E>): Promise<A> => {
  const result = await Effect.runPromise(Effect.result(eff));
  if (Result.isFailure(result)) throw new Error(`expected success, got ${String(result.failure)}`);
  return result.success;
};

const createReq = (): ScoreboardCreateRequest => ({ id: crypto.randomUUID(), gameName: "Catan" });

describe("auth: create requires a signed-in user", () => {
  test("creating without a userId is refused as unauthorized", async () => {
    const fake = makeFakeDb(null);
    const failure = await failureOf(createScoreboard(fake.db)(createReq(), null));
    expect(failure._tag).toBe("UnauthorizedError");
    expect((failure as { code: number }).code).toBe(401);
    expect(fake.row()).toBeNull();
  });

  test("creating with a userId stamps the board with its owner", async () => {
    const fake = makeFakeDb(null);
    const dto = await successOf(createScoreboard(fake.db)(createReq(), "user_abc"));
    expect(dto.ownerId).toBe("user_abc");
    expect(fake.row()?.ownerId).toBe("user_abc");
  });
});

describe("auth: claim makes the first signed-in viewer the owner", () => {
  test("claiming an ownerless board sets ownerId", async () => {
    const fake = makeFakeDb(board());
    const dto = await successOf(claimScoreboard(fake.db)("11111111-1111-1111-1111-111111111111", "user_abc"));
    expect(dto.ownerId).toBe("user_abc");
  });

  test("claiming without a userId is refused as unauthorized", async () => {
    const fake = makeFakeDb(board());
    const failure = await failureOf(
      claimScoreboard(fake.db)("11111111-1111-1111-1111-111111111111", null),
    );
    expect(failure._tag).toBe("UnauthorizedError");
    expect(fake.row()?.ownerId).toBeNull();
  });

  test("claiming an already-owned board is refused", async () => {
    const fake = makeFakeDb(board({ ownerId: "user_owner" }));
    const failure = await failureOf(
      claimScoreboard(fake.db)("11111111-1111-1111-1111-111111111111", "user_late"),
    );
    expect(failure._tag).toBe("ForbiddenError");
    expect(fake.row()?.ownerId).toBe("user_owner");
  });

  test("concurrent claims produce exactly one winner", async () => {
    const fake = makeFakeDb(board());
    const run = (userId: string) =>
      Effect.runPromise(
        Effect.result(claimScoreboard(fake.db)("11111111-1111-1111-1111-111111111111", userId)),
      );
    const [first, second] = await Promise.all([run("user_first"), run("user_second")]);
    const winners = [first, second].filter(Result.isSuccess);
    const losers = [first, second].filter(Result.isFailure);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
  });

  test("claiming a missing board reports not-found", async () => {
    const fake = makeFakeDb(null);
    const failure = await failureOf(claimScoreboard(fake.db)("missing-id", "user_abc"));
    expect(failure._tag).toBe("NotFoundError");
  });
});
