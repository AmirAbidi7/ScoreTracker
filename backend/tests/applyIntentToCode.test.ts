import { describe, expect, spyOn, test } from "bun:test";
import { Effect, Result } from "effect";
import type { Db } from "../config/db";
import type { Player } from "../models/Scoreboard";
import { applyIntentToCode } from "../service/scoreboardIntentService";

/**
 * The read-then-write, driven against a fake `Db` rather than a database.
 *
 * The race this file exists for needs two things a live database makes awkward
 * to arrange and a double makes exact: both reads have to land *before* either
 * write, and the ordering token has to be predictable. So the fake snapshots the
 * row when it is read and resolves on a later tick, which is what puts the two
 * reads in the same instant — the situation the real thing hits whenever two
 * intents arrive within one round trip.
 */

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
  /** Every read and every write, in the order the service issued them. */
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
  /**
   * The whole point of the lock. Two intents for one board used to both read the
   * same row and both write it, so the second write carried the first intent's
   * arithmetic and a point vanished — reachable from a single device, because
   * the app has no in-flight guard on `+` and an impatient double tap is two
   * intents. Nothing in the response says so: the board that comes back looks
   * entirely plausible.
   */
  test("two intents for one board both land", async () => {
    const fake = makeFakeDb(row([{ id: 1, name: "Amir", score: 0 }]));
    const apply = applyIntentToCode(fake.db);

    const [first, second] = await Promise.all([
      run(apply("AB12CD", { type: "addScore", playerId: 1, amount: 1 })),
      run(apply("AB12CD", { type: "addScore", playerId: 1, amount: 1 })),
    ]);

    expect(fake.row().players).toEqual([{ id: 1, name: "Amir", score: 2 }]);
    // Each caller is answered with the board as it stood after its own write, so
    // the second answer is the one that is on disk — not the same stale board
    // twice, which is what an un-serialised pair of acks would have returned.
    expect(first.players[0]?.score).toBe(1);
    expect(second.players[0]?.score).toBe(2);
  });

  /**
   * The same claim stated on the wire traffic rather than the result, because
   * "the two reads did not overlap" is the invariant and the score is a
   * consequence of it. Un-serialised, this reads `["read", "read", "write",
   * "write"]` — and it would still be wrong if only the *write* had been locked,
   * which is why the read is inside the permit and not next to it.
   */
  test("a read never overlaps another read of the same board", async () => {
    const fake = makeFakeDb(row([{ id: 1, name: "Amir", score: 0 }]));
    const apply = applyIntentToCode(fake.db);

    await Promise.all([
      run(apply("AB12CD", { type: "addScore", playerId: 1, amount: 1 })),
      run(apply("AB12CD", { type: "addScore", playerId: 1, amount: 1 })),
    ]);

    expect(fake.log).toEqual(["read", "write", "read", "write"]);
  });

  /**
   * The ordering token every client compares, and the second half of the same
   * defect. `$onUpdate(() => new Date())` has millisecond resolution, so two
   * writes inside one millisecond produce the same token — and the client's guard
   * is a strict `>`, so the second board is discarded on every client and on
   * every re-read, leaving the room permanently a point behind. Serialising the
   * writes does not remove that collision, it just narrows it to the case where
   * both writes really are in the same millisecond, which is now the common one
   * for a double tap.
   *
   * The clock is frozen so both writes genuinely land in the same millisecond;
   * the tokens still have to advance, one millisecond at a time.
   */
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
    // The board the second caller is handed carries the token the client is
    // being asked to accept, rather than one it will discard as not-newer.
    expect(fake.row().updateTime.toISOString()).toBe("2026-09-25T10:00:00.002Z");
  });

  /** A clock that has run past the stored token still wins, so time never goes back. */
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

  /**
   * `withPermit` releases when the effect exits, however it exits. A refused
   * intent takes the permit with it, and the next one has to run: a board whose
   * first intent was rejected would otherwise never accept another.
   */
  test("a rejected intent releases the permit for the next one", async () => {
    const fake = makeFakeDb(row([{ id: 1, name: "Amir", score: 0 }]));
    const apply = applyIntentToCode(fake.db);

    const refused = await Effect.runPromise(
      Effect.result(apply("AB12CD", { type: "addScore", playerId: 99, amount: 1 })),
    );
    expect(Result.isFailure(refused)).toBe(true);
    // A refusal writes nothing: the intent is the only authority on what changed.
    expect(fake.log).toEqual(["read"]);

    const accepted = await run(apply("AB12CD", { type: "addScore", playerId: 1, amount: 1 }));

    expect(accepted.players[0]?.score).toBe(1);
    expect(fake.log).toEqual(["read", "read", "write"]);
  });
});
