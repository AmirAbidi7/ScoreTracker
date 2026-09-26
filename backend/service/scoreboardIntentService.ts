import { eq } from "drizzle-orm";
import { Context, Effect, Layer, PartitionedSemaphore } from "effect";
import { Database, DatabaseLive, type Db } from "../config/db";
import type { ScoreboardDTO } from "../dto/ScoreboardDTO";
import type { ScoreboardIntent } from "../dto/ScoreboardIntent";
import { InternalServerError, InvalidIntentError, NotFoundError } from "../errors/errors";
import { scoreboardsTable } from "../models/Scoreboard";
import { getScoreboardByCode, toScoreboardDTO } from "./scoreboardService";

/**
 * Pure. Computes the next board from an intent. Contains no database or socket
 * access, which is what lets the whole mutation model be tested in one file.
 *
 * Returns a new board and never mutates its argument, so a rejected intent
 * leaves callers holding a still-valid board.
 */
export const applyIntent = (
  board: ScoreboardDTO,
  intent: ScoreboardIntent,
): Effect.Effect<ScoreboardDTO, InvalidIntentError> =>
  Effect.gen(function* () {
    switch (intent.type) {
      case "addScore": {
        const player = board.players.find((p) => p.id === intent.playerId);
        if (!player) {
          return yield* Effect.fail(
            new InvalidIntentError({
              message: `scoreboard ${board.id} has no player with id ${intent.playerId}`,
            }),
          );
        }
        return {
          ...board,
          players: board.players.map((p) =>
            p.id === intent.playerId ? { ...p, score: p.score + intent.amount } : p,
          ),
        };
      }

      case "addPlayer": {
        const name = intent.name.trim();
        if (name.length === 0) {
          return yield* Effect.fail(
            new InvalidIntentError({ message: `player name must not be empty` }),
          );
        }
        const nextId = board.players.reduce((max, p) => Math.max(max, p.id), 0) + 1;
        return { ...board, players: [...board.players, { id: nextId, name, score: 0 }] };
      }

      case "removePlayer": {
        if (!board.players.some((p) => p.id === intent.playerId)) {
          return yield* Effect.fail(
            new InvalidIntentError({
              message: `scoreboard ${board.id} has no player with id ${intent.playerId}`,
            }),
          );
        }
        return { ...board, players: board.players.filter((p) => p.id !== intent.playerId) };
      }
    }
  });

export const roomFor = (code: string) => `scoreboard:${code}`;

export type ScoreboardIntentServiceInterface = {
  /**
   * Load the board for `code`, apply `intent`, persist, return the canonical
   * result. Broadcasting is the caller's job — this service does not emit.
   */
  readonly applyIntentToCode: (
    code: string,
    intent: ScoreboardIntent,
  ) => Effect.Effect<ScoreboardDTO, NotFoundError | InternalServerError | InvalidIntentError>;
};

export class ScoreboardIntentService extends Context.Service<
  ScoreboardIntentService,
  ScoreboardIntentServiceInterface
>()("ScoreboardIntentService") {}

/**
 * One intent's read-modify-write at a time, in this process.
 *
 * An intent is read, applied and written back, and nothing between those steps
 * holds a database lock, so two intents for one board arriving together both
 * read the same row and both write: last-write-wins, and a point is lost. That is
 * reachable from a single device — the app has no in-flight guard on `+`, so a
 * double tap is two intents — and the loss is invisible, because the broadcast
 * that follows carries a perfectly plausible board.
 *
 * A mutex rather than a transaction, and deliberately:
 *
 * - A `SELECT … FOR UPDATE` transaction is the database-level answer, and it is
 *   the right one for a deployment that runs more than one instance of this
 *   process. It is not the right one here: this backend is a single instance
 *   (one Neon database, one `index.ts`), it has no migration budget for a
 *   serialisation change that the current volume does not need, and a
 *   transaction would have to be hand-rolled on a second connection because
 *   nothing in this codebase owns one.
 * - The permit is keyed by `code` but the pool holds one, so an intent for one
 *   board also waits for an intent for another. That is a throughput ceiling
 *   this app does not approach — an intent is one indexed `SELECT` and one
 *   `UPDATE` — and it buys a whole-process invariant that is trivial to audit:
 *   at most one intent is ever between its read and its write.
 * - `withPermit` releases on exit however it exits, so a failed write, a
 *   rejected intent and an interrupt all leave the next intent able to run. A
 *   hand-rolled queue would have to remember that in three places.
 */
const INTENT_WRITES = PartitionedSemaphore.makeUnsafe<string>({ permits: 1 });

/**
 * The ordering token for a write, which every client compares.
 *
 * The column's `$onUpdate(() => new Date())` is millisecond-resolution, so two
 * writes in the same millisecond produce the *same* `updateTime` — and the
 * client's guard is a strict `>`, so the second board is discarded on every
 * client and on every re-read. The room then shows a score that is one intent
 * behind for good: silent, and it does not recover until something else writes.
 *
 * Serialising the writes does not remove that tie — it makes it the *only* way
 * two writes can collide, which is to say it makes it common. So the token is
 * computed here instead, from server time and the value this write is replacing,
 * and is advanced by at least a millisecond. It is still the server's clock and
 * still the server's decision; naming the column is only unsafe when the value
 * is one a client chose or one that fails to advance.
 */
const nextUpdateTime = (previous: string): Date =>
  new Date(Math.max(Date.now(), Date.parse(previous) + 1));

/**
 * Exported for its own tests: the layer below is wired to the live database, and
 * the read-then-write this does is the part worth testing without one.
 */
export const applyIntentToCode =
  (db: Db) => (code: string, intent: ScoreboardIntent) =>
    PartitionedSemaphore.withPermit(INTENT_WRITES, code, Effect.gen(function* () {
      // The read is inside the lock, and on the same `db` as the write. A
      // transaction around the write alone would not have included it, and would
      // have looked like a fix while leaving the race exactly where it was.
      const current = yield* getScoreboardByCode(db)(code);

      const next = yield* applyIntent(current, intent);

      // The write is deliberately narrower than a full-document replace: the
      // intent is the only authority on what changed, so nothing else is written
      // here. `updateTime` is the one exception and it is not the clients' — see
      // `nextUpdateTime`.
      const updated = yield* Effect.tryPromise({
        try: () =>
          db
            .update(scoreboardsTable)
            .set({ players: next.players, updateTime: nextUpdateTime(current.updateTime) })
            .where(eq(scoreboardsTable.id, current.id))
            .returning(),
        catch: () => new InternalServerError({ message: `Internal Server Error` }),
      });

      const row = updated[0];

      if (!row) {
        return yield* Effect.fail(
          new NotFoundError({
            message: `scoreboard with id:${current.id} vanished during the update`,
          }),
        );
      }

      return toScoreboardDTO(row);
    }));

/**
 * `DatabaseLive` is provided here rather than left to the caller so the service
 * owns the one pool both halves of its read-then-write run on. `AppLayer` still
 * builds its own, for the controller; two pools for two independently writable
 * paths is a resource question, not a correctness one.
 */
export const ScoreboardIntentServiceLive = Layer.effect(
  ScoreboardIntentService,
  Effect.gen(function* () {
    const db = yield* Database;

    return ScoreboardIntentService.of({
      applyIntentToCode: applyIntentToCode(db),
    });
  }),
).pipe(Layer.provide(DatabaseLive));
