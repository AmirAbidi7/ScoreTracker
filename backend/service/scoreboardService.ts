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

export type ScoreboardServiceInterface = {
  readonly createScoreboard: (
    scoreboardRequest: ScoreboardCreateRequest,
  ) => Effect.Effect<ScoreboardDTO, InternalServerError>;
  readonly getScoreboard: (
    id: string,
  ) => Effect.Effect<ScoreboardDTO, NotFoundError | InternalServerError>;
  readonly getScoreboards: () => Effect.Effect<ScoreboardDTO[], InternalServerError>;
  readonly updateScoreboard: (
    Scoreboard: ScoreboardDTO,
  ) => Effect.Effect<ScoreboardDTO, InternalServerError | NotFoundError>;
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

const updateScoreboard = (db: Db) => (scoreboard: ScoreboardDTO) =>
  Effect.gen(function* () {
    // The client doesn't author the ordering token: drop `updateTime` from the
    // write so the column's `$onUpdate` bumps it to server time instead of
    // echoing a stale client value that other clients would then discard.
    const { updateTime: _updateTime, ...updatable } = scoreboard;
    const newScoreboards = yield* Effect.tryPromise({
      try: () =>
        db
          .update(scoreboardsTable)
          .set({ ...updatable })
          .where(eq(scoreboardsTable.id, scoreboard.id))
          .returning(boardColumns),
      catch: () => new InternalServerError({ message: `Internal Server Error` }),
    });
    const newScoreboard = newScoreboards[0];

    if (!newScoreboard) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `Couldn't find a scoreboard with id:${scoreboard.id}`,
        }),
      );
    }

    return toScoreboardDTO(newScoreboard);
  });

const joinScoreboard = (db: Db) => (code: string) =>
  Effect.gen(function* () {
    const scoreboards = yield* Effect.tryPromise({
      try: () =>
        db.select(boardColumns).from(scoreboardsTable).where(eq(scoreboardsTable.code, code)),
      catch: () =>
        new InternalServerError({
          message: `Internal Server Error`,
        }),
    });

    const scoreboard = scoreboards[0];

    if (!scoreboard) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `scoreboard with code:${code} Not found!`,
        }),
      );
    }

    return toScoreboardDTO(scoreboard);
  });

const getScoreboardByCode = (db: Db) => (code: string) =>
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

export const ScoreboardServiceLive = Layer.effect(
  ScoreboardService,
  Effect.gen(function* () {
    const db = yield* Database;

    return ScoreboardService.of({
      createScoreboard: createScoreboard(db),
      getScoreboard: getScoreboard(db),
      getScoreboards: getScoreboards(db),
      updateScoreboard: updateScoreboard(db),
      deleteScoreboard: deleteScoreboard(db),
      joinScoreboard: joinScoreboard(db),
      getScoreboardByCode: getScoreboardByCode(db),
    });
  }),
).pipe(Layer.provide(DatabaseLive));
