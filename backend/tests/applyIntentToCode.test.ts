import { describe, expect, spyOn, test } from "bun:test";
import { Effect, Result } from "effect";
import type { Db } from "../config/db";
import type { Player } from "../models/Scoreboard";
import { applyIntentToCode } from "../service/scoreboardIntentService";

type Row = {
  id: string;
  gameName: string;
  code: string;
  players: Player[];
  updateTime: Date;
};

const row = (players: Player[]): Row => ({
  id: "11111111-1111-1111-1111-111111111111",
  gameName: "Catan",
  code: "AB12CD",
  players,
  updateTime: new Date("2026-09-25T10:00:00.000Z"),
});

type Write = { players: Player[]; updateTime: Date };

const makeFakeDb = (initial: Row) => {
  let stored = initial;
  const log: string[] = [];
  const writes: Write[] = [];

  const db = {
    select: () => ({
      from: () => ({
        where: () => {
          const snapshot: Row = {
            ...stored,
            players: stored.players.map((player) => ({ ...player })),
          };
          log.push("read");
          return new Promise<Row[]>((resolve) => {
            setTimeout(() => {
              resolve([snapshot]);
            }, 0);
          });
        },
      }),
    }),
    update: () => ({
      set: (values: Write) => ({
        where: () => ({
          returning: () => {
            log.push("write");
            writes.push(values);
            stored = { ...stored, players: values.players, updateTime: values.updateTime };
            return Promise.resolve<Row[]>([stored]);
          },
        }),
      }),
    }),
  };

  return { db: db as unknown as Db, log, writes, row: () => stored };
};

const run = async <A, E>(eff: Effect.Effect<A, E>): Promise<A> => {
  const result = await Effect.runPromise(Effect.result(eff));
  if (Result.isFailure(result)) {
    throw new Error(`the intent failed: ${String(result.failure)}`);
  }
  return result.success;
};

describe("applyIntentToCode", () => {
  test("two intents for one board both land", async () => {
    const fake = makeFakeDb(row([{ id: 1, name: "Amir", score: 0 }]));
    const apply = applyIntentToCode(fake.db);

    const [first, second] = await Promise.all([
      run(apply("AB12CD", { type: "addScore", playerId: 1, amount: 1 })),
      run(apply("AB12CD", { type: "addScore", playerId: 1, amount: 1 })),
    ]);

    expect(fake.row().players).toEqual([{ id: 1, name: "Amir", score: 2 }]);
    expect(first.players[0]?.score).toBe(1);
    expect(second.players[0]?.score).toBe(2);
  });

  test("a read never overlaps another read of the same board", async () => {
    const fake = makeFakeDb(row([{ id: 1, name: "Amir", score: 0 }]));
    const apply = applyIntentToCode(fake.db);

    await Promise.all([
      run(apply("AB12CD", { type: "addScore", playerId: 1, amount: 1 })),
      run(apply("AB12CD", { type: "addScore", playerId: 1, amount: 1 })),
    ]);

    expect(fake.log).toEqual(["read", "write", "read", "write"]);
  });

  test("two writes in the same millisecond still get distinct ordering tokens", async () => {
    const fake = makeFakeDb(row([{ id: 1, name: "Amir", score: 0 }]));
    const apply = applyIntentToCode(fake.db);

    const clock = spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-25T10:00:00.000Z"));
    try {
      await run(apply("AB12CD", { type: "addScore", playerId: 1, amount: 1 }));
      await run(apply("AB12CD", { type: "addScore", playerId: 1, amount: 1 }));
    } finally {
      clock.mockRestore();
    }

    expect(fake.writes.map((write) => write.updateTime.toISOString())).toEqual([
      "2026-09-25T10:00:00.001Z",
      "2026-09-25T10:00:00.002Z",
    ]);
    expect(fake.row().updateTime.toISOString()).toBe("2026-09-25T10:00:00.002Z");
  });

  test("a token advances to server time when that is later", async () => {
    const fake = makeFakeDb(row([{ id: 1, name: "Amir", score: 0 }]));
    const apply = applyIntentToCode(fake.db);

    const clock = spyOn(Date, "now").mockReturnValue(Date.parse("2026-09-25T12:00:00.000Z"));
    try {
      await run(apply("AB12CD", { type: "addScore", playerId: 1, amount: 1 }));
    } finally {
      clock.mockRestore();
    }

    expect(fake.writes[0]?.updateTime.toISOString()).toBe("2026-09-25T12:00:00.000Z");
  });

  test("a rejected intent releases the permit for the next one", async () => {
    const fake = makeFakeDb(row([{ id: 1, name: "Amir", score: 0 }]));
    const apply = applyIntentToCode(fake.db);

    const refused = await Effect.runPromise(
      Effect.result(apply("AB12CD", { type: "addScore", playerId: 99, amount: 1 })),
    );
    expect(Result.isFailure(refused)).toBe(true);
    expect(fake.log).toEqual(["read"]);

    const accepted = await run(apply("AB12CD", { type: "addScore", playerId: 1, amount: 1 }));

    expect(accepted.players[0]?.score).toBe(1);
    expect(fake.log).toEqual(["read", "read", "write"]);
  });
});
