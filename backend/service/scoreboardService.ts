import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Database, DatabaseLive, type Db } from "../config/db";
import type { ScoreboardCreateRequest, ScoreboardDTO } from "../dto/ScoreboardDTO";
import { InternalServerError, NotFoundError } from "../errors/errors";
import { scoreboardsTable } from "../models/Scoreboard";
import { generateCode } from "../utils/generateCode";
import { time } from "effect/Console";

/**
 * Row shape produced by {@link boardColumns}. Derived from the schema via
 * `$inferSelect` — `typeof scoreboardsTable` types its properties as column
 * objects, not row data — and narrowed to the projected columns so every
 * partial select/returning result is assignable to it.
 */
type ScoreboardRow = Pick<
  typeof scoreboardsTable.$inferSelect,
  "id" | "gameName" | "code" | "players" | "updateTime"
>;

/**
 * Single mapping point from a database row to the wire DTO. The `updateTime`
 * column is nullable in the schema but always populated by `defaultNow()`;
 * the `?? new Date(0)` keeps a stray null from producing an unorderable value.
 */
export const toScoreboardDTO = (row: ScoreboardRow): ScoreboardDTO => ({
  id: row.id,
  gameName: row.gameName,
  code: row.code,
  players: row.players,
  updateTime: (row.updateTime ?? new Date(0)).toISOString(),
});

/** The exact projection used by every read that returns a board. */
const boardColumns = {
  id: scoreboardsTable.id,
  gameName: scoreboardsTable.gameName,
  players: scoreboardsTable.players,
  code: scoreboardsTable.code,
  updateTime: scoreboardsTable.updateTime,
};

/**
 * Reads and the one deletion. There is deliberately no "write this board" method:
 * a client's word about a score is an intent, and `applyIntent` in
 * `scoreboardIntentService.ts` is the only thing that turns one into a board.
 * A wholesale write would let any caller — and any future HTTP route — author
 * scores, which is the invariant the whole design turns on.
 */
export type ScoreboardServiceInterface = {
  readonly createScoreboard: (
    scoreboardRequest: ScoreboardCreateRequest,
  ) => Effect.Effect<ScoreboardDTO, InternalServerError>;
  readonly getScoreboard: (
    id: string,
  ) => Effect.Effect<ScoreboardDTO, NotFoundError | InternalServerError>;
  readonly getScoreboards: () => Effect.Effect<ScoreboardDTO[], InternalServerError>;
  readonly deleteScoreboard: (
    scoreboardId: string,
  ) => Effect.Effect<string, InternalServerError | NotFoundError>;
  readonly joinScoreboard: (
    code: string,
  ) => Effect.Effect<ScoreboardDTO, NotFoundError | InternalServerError>;
  readonly getScoreboardByCode: (
    code: string,
  ) => Effect.Effect<ScoreboardDTO, NotFoundError | InternalServerError>;
};

export class ScoreboardService extends Context.Service<
  ScoreboardService,
  ScoreboardServiceInterface
>()("ScoreboardService") {}

const createScoreboard = (db: Db) => (scoreboardReq: ScoreboardCreateRequest) =>
  Effect.gen(function* () {
    const scoreboards = yield* Effect.tryPromise({
      try: () =>
        db
          .insert(scoreboardsTable)
          .values({
            id: scoreboardReq.id,
            gameName: scoreboardReq.gameName,
            code: generateCode(),
          })
          .returning(boardColumns),
      catch: () => new InternalServerError({ message: "Internal Server Error" }),
    });

    const scoreboard = scoreboards[0];
    if (!scoreboard) {
      return yield* Effect.fail(new InternalServerError({ message: `Internal Server Error` }));
    }

    return toScoreboardDTO(scoreboard);
  });

const getScoreboard = (db: Db) => (id: string) =>
  Effect.gen(function* () {
    const scoreboards = yield* Effect.tryPromise({
      try: () =>
        db.select(boardColumns).from(scoreboardsTable).where(eq(scoreboardsTable.id, id)),
      catch: () =>
        new InternalServerError({
          message: `Internal Server Error`,
        }),
    });
    const scoreboard = scoreboards[0];

    if (!scoreboard) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `Couldn't find a scoreboard with id:${id}`,
        }),
      );
    }

    return toScoreboardDTO(scoreboard);
  });

const getScoreboards = (db: Db) => () =>
  Effect.gen(function* () {
    const scoreboards = yield* Effect.tryPromise({
      try: () => db.select(boardColumns).from(scoreboardsTable),
      catch: () => new InternalServerError({ message: `Error fetching all scoreboards!` }),
    });

    const scoreboardsDTO: ScoreboardDTO[] = scoreboards.map(toScoreboardDTO);

    return scoreboardsDTO;
  });

const deleteScoreboard = (db: Db) => (id: string) =>
  Effect.gen(function* () {
    const values = yield* Effect.tryPromise({
      try: () =>
        db.delete(scoreboardsTable).where(eq(scoreboardsTable.id, id)).returning({
          code: scoreboardsTable.code,
        }),
      catch: () => new InternalServerError({ message: `Internal Server Error` }),
    });

    const value = values[0];

    if (!value) {
      return yield* Effect.fail(
        new NotFoundError({ message: `scoreboard with id:${id} not found` }),
      );
    }

    return value.code;
  });

/**
 * The read half of `applyIntentToCode`, exported for it.
 *
 * Both halves have to run against the *same* `db`. That service used to reach
 * this read through an injected `ScoreboardService`, which carries its own pool,
 * so the read and the write that depended on it were two unrelated connections:
 * no transaction could ever have made them atomic together.
 */
export const getScoreboardByCode = (db: Db) => (code: string) =>
  Effect.gen(function* () {
    const scoreboards = yield* Effect.tryPromise({
      try: () =>
        db.select(boardColumns).from(scoreboardsTable).where(eq(scoreboardsTable.code, code)),
      catch: () => new InternalServerError({ message: `Internal Server Error` }),
    });

    const scoreboard = scoreboards[0];

    if (!scoreboard) {
      return yield* Effect.fail(
        new NotFoundError({ message: `scoreboard with code:${code} not found` }),
      );
    }

    return toScoreboardDTO(scoreboard);
  });

// The join route's name for the same lookup by code.
const joinScoreboard = getScoreboardByCode;

export const ScoreboardServiceLive = Layer.effect(
  ScoreboardService,
  Effect.gen(function* () {
    const db = yield* Database;

    return ScoreboardService.of({
      createScoreboard: createScoreboard(db),
      getScoreboard: getScoreboard(db),
      getScoreboards: getScoreboards(db),
      deleteScoreboard: deleteScoreboard(db),
      joinScoreboard: joinScoreboard(db),
      getScoreboardByCode: getScoreboardByCode(db),
    });
  }),
).pipe(Layer.provide(DatabaseLive));
