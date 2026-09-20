import { Context, Effect, Layer } from "effect";
import type { ScoreboardDTO } from "../dto/ScoreboardDTO";
import { Database, type Db } from "../config/db";
import { scoreboardsTable, type Scoreboard } from "../models/Scoreboard";
import { eq } from "drizzle-orm";
import { InternalServerError, NotFoundError } from "../errors/errors";

class ScoreboardService extends Context.Service<
  ScoreboardService,
  {
    readonly getScoreboard: (id: string) => Effect.Effect<ScoreboardDTO, NotFoundError>;
    readonly getScoreboards: () => Effect.Effect<ScoreboardDTO[]>;
    readonly updateScoreboard: (Scoreboard: ScoreboardDTO) => Effect.Effect<ScoreboardDTO>;
    readonly deleteScoreboard: (scoreboardId: string) => Effect.Effect<string>;
    readonly joinScoreboard: (scoreboardCode: string) => Effect.Effect<ScoreboardDTO>;
  }
>()("ScoreboardService") {}

const ScoreboardServiceLive = Layer.effect(
  ScoreboardService,
  Effect.gen(function* () {
    const db = yield* Database;

    return ScoreboardService.of({
      getScoreboard: getScoreboard(db),
    });
  }),
);

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
