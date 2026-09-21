import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Database, DatabaseLive, type Db } from "../config/db";
import type { ScoreboardCreateRequest, ScoreboardDTO } from "../dto/ScoreboardDTO";
import { InternalServerError, NotFoundError } from "../errors/errors";
import { scoreboardsTable } from "../models/Scoreboard";

export type ScoreboardServiceInterface = {
  readonly createScoreboard: (
    scoreboardRequest: ScoreboardCreateRequest,
  ) => Effect.Effect<ScoreboardDTO, InternalServerError>;
  readonly getScoreboard: (id: string) => Effect.Effect<ScoreboardDTO, NotFoundError>;
  readonly getScoreboards: () => Effect.Effect<ScoreboardDTO[], InternalServerError>;
  readonly updateScoreboard: (
    Scoreboard: ScoreboardDTO,
  ) => Effect.Effect<ScoreboardDTO, InternalServerError>;
  readonly deleteScoreboard: (scoreboardId: string) => Effect.Effect<string, InternalServerError>;
  readonly joinScoreboard: (code: string) => Effect.Effect<ScoreboardDTO, NotFoundError>;
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
          })
          .returning({
            id: scoreboardsTable.id,
            gameName: scoreboardsTable.gameName,
            players: scoreboardsTable.players,
          }),
      catch: () => new InternalServerError({ message: "Internal Server Error" }),
    });

    const scoreboard = scoreboards[0];

    const scoreboardDTO: ScoreboardDTO = {
      id: scoreboard!.id,
      gameName: scoreboard!.gameName,
      players: scoreboard!.players,
    };
    return scoreboardDTO;
  });

const getScoreboard = (db: Db) => (id: string) =>
  Effect.gen(function* () {
    const scoreboards = yield* Effect.tryPromise({
      try: () => db.select().from(scoreboardsTable).where(eq(scoreboardsTable.id, id)),
      catch: () =>
        new NotFoundError({
          message: `Couldn't find a scoreboard with that id!`,
        }),
    });
    const scoreboard = scoreboards[0];

    if (!scoreboard) {
      yield* Effect.fail(
        new NotFoundError({
          message: `Couldn't find a scoreboard with id:${id}`,
        }),
      );
    }

    const scoreboardDTO: ScoreboardDTO = {
      id: scoreboard!.id,
      gameName: scoreboard!.gameName,
      players: scoreboard!.players,
    };
    return scoreboardDTO;
  });

const getScoreboards = (db: Db) => () =>
  Effect.gen(function* () {
    const scoreboards = yield* Effect.tryPromise({
      try: () => db.select().from(scoreboardsTable),
      catch: () => new InternalServerError({ message: `Error fetching all scoreboards!` }),
    });

    const scoreboardsDTO: ScoreboardDTO[] = scoreboards.map((scoreboard) => ({
      gameName: scoreboard.gameName,
      id: scoreboard.id,
      players: scoreboard.players,
    }));

    return scoreboardsDTO;
  });

const deleteScoreboard = (db: Db) => (id: string) =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => db.delete(scoreboardsTable).where(eq(scoreboardsTable.id, id)),
      catch: () => new InternalServerError({ message: `Internal Server Error` }),
    });
    return "Scoreboard Deleted successfully!";
  });

const updateScoreboard = (db: Db) => (scoreboard: ScoreboardDTO) =>
  Effect.gen(function* () {
    const newScoreboard = yield* Effect.tryPromise({
      try: () =>
        db
          .update(scoreboardsTable)
          .set({
            ...scoreboard,
          })
          .where(eq(scoreboardsTable.id, scoreboard.id))
          .returning({
            id: scoreboardsTable.id,
            gameName: scoreboardsTable.gameName,
            players: scoreboardsTable.players,
          }),
      catch: () => new InternalServerError({ message: `Internal Server Error` }),
    });

    const scoreboardDTO: ScoreboardDTO = {
      id: newScoreboard[0]!.id,
      gameName: newScoreboard[0]!.gameName,
      players: newScoreboard[0]!.players,
    };

    return scoreboardDTO;
  });

const joinScoreboard = (db: Db) => (code: string) =>
  Effect.gen(function* () {
    const scoreboards = yield* Effect.tryPromise({
      try: () => db.select().from(scoreboardsTable).where(eq(scoreboardsTable.code, code)),
      catch: () =>
        new NotFoundError({
          message: `Couldn't find scoreboard with code:${code}, please verify the code before entering it next time!`,
        }),
    });

    const scoreboard = scoreboards[0];

    const scoreboardDTO: ScoreboardDTO = {
      id: scoreboard!.id,
      gameName: scoreboard!.gameName,
      players: scoreboard!.players,
    };
    return scoreboardDTO;
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
    });
  }),
).pipe(Layer.provide(DatabaseLive));
