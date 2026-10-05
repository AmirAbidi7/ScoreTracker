import { and, eq, isNull } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Database, DatabaseLive, type Db } from "../config/db";
import type { ScoreboardCreateRequest, ScoreboardDTO } from "../dto/ScoreboardDTO";
import {
  ForbiddenError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "../errors/errors";
import { scoreboardsTable } from "../models/Scoreboard";
import { generateCode } from "../utils/generateCode";

type ScoreboardRow = Pick<
  typeof scoreboardsTable.$inferSelect,
  "id" | "gameName" | "code" | "players" | "updateTime" | "ownerId"
>;

export const toScoreboardDTO = (row: ScoreboardRow): ScoreboardDTO => ({
  id: row.id,
  gameName: row.gameName,
  code: row.code,
  players: row.players,
  updateTime: (row.updateTime ?? new Date(0)).toISOString(),
  ownerId: row.ownerId,
});

const boardColumns = {
  id: scoreboardsTable.id,
  gameName: scoreboardsTable.gameName,
  players: scoreboardsTable.players,
  code: scoreboardsTable.code,
  updateTime: scoreboardsTable.updateTime,
  ownerId: scoreboardsTable.ownerId,
};

export type ScoreboardServiceInterface = {
  readonly createScoreboard: (
    scoreboardRequest: ScoreboardCreateRequest,
    userId: string | null,
  ) => Effect.Effect<ScoreboardDTO, InternalServerError | UnauthorizedError>;
  readonly getScoreboard: (
    id: string,
  ) => Effect.Effect<ScoreboardDTO, NotFoundError | InternalServerError>;
  readonly getScoreboards: () => Effect.Effect<ScoreboardDTO[], InternalServerError>;
  readonly deleteScoreboard: (
    scoreboardId: string,
    userId: string | null,
  ) => Effect.Effect<string, InternalServerError | NotFoundError | UnauthorizedError | ForbiddenError>;
  readonly joinScoreboard: (
    code: string,
  ) => Effect.Effect<ScoreboardDTO, NotFoundError | InternalServerError>;
  readonly getScoreboardByCode: (
    code: string,
  ) => Effect.Effect<ScoreboardDTO, NotFoundError | InternalServerError>;
  readonly claimScoreboard: (
    scoreboardId: string,
    userId: string | null,
  ) => Effect.Effect<ScoreboardDTO, InternalServerError | NotFoundError | UnauthorizedError | ForbiddenError>;
};

export class ScoreboardService extends Context.Service<
  ScoreboardService,
  ScoreboardServiceInterface
>()("ScoreboardService") {}

const createScoreboard =
  (db: Db) => (scoreboardReq: ScoreboardCreateRequest, userId: string | null) =>
    Effect.gen(function* () {
      if (!userId) {
        return yield* Effect.fail(
          new UnauthorizedError({ message: "Sign in to create a scoreboard" }),
        );
      }
      const scoreboards = yield* Effect.tryPromise({
        try: () =>
          db
            .insert(scoreboardsTable)
            .values({
              id: scoreboardReq.id,
              gameName: scoreboardReq.gameName,
              code: generateCode(),
              ownerId: userId,
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
      try: () => db.select(boardColumns).from(scoreboardsTable).where(eq(scoreboardsTable.id, id)),
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

const deleteScoreboard = (db: Db) => (id: string, userId: string | null) =>
  Effect.gen(function* () {
    if (!userId) {
      return yield* Effect.fail(
        new UnauthorizedError({ message: "Sign in to delete this scoreboard" }),
      );
    }
    const current = yield* getScoreboard(db)(id);
    if (current.ownerId === null) {
      return yield* Effect.fail(
        new ForbiddenError({ message: "Claim this board before deleting it" }),
      );
    }
    if (current.ownerId !== userId) {
      return yield* Effect.fail(
        new ForbiddenError({ message: "Only the owner can delete this board" }),
      );
    }
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
        new NotFoundError({
          message: `scoreboard with code:${code} not found`,
        }),
      );
    }

    return toScoreboardDTO(scoreboard);
  });

const joinScoreboard = getScoreboardByCode;

const claimScoreboard = (db: Db) => (id: string, userId: string | null) =>
  Effect.gen(function* () {
    if (!userId) {
      return yield* Effect.fail(
        new UnauthorizedError({ message: "Sign in to claim this board" }),
      );
    }
    // One atomic statement: exactly one concurrent claim sees ownerId IS NULL.
    const claimed = yield* Effect.tryPromise({
      try: () =>
        db
          .update(scoreboardsTable)
          .set({ ownerId: userId })
          .where(and(eq(scoreboardsTable.id, id), isNull(scoreboardsTable.ownerId)))
          .returning(boardColumns),
      catch: () => new InternalServerError({ message: `Internal Server Error` }),
    });

    const winner = claimed[0];
    if (winner) return toScoreboardDTO(winner);

    const current = yield* getScoreboard(db)(id);
    if (current.ownerId !== null) {
      return yield* Effect.fail(
        new ForbiddenError({ message: "This board already has an owner" }),
      );
    }
    return yield* Effect.fail(new InternalServerError({ message: `Internal Server Error` }));
  });

export { claimScoreboard, createScoreboard, deleteScoreboard };

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
      claimScoreboard: claimScoreboard(db),
    });
  }),
).pipe(Layer.provide(DatabaseLive));
