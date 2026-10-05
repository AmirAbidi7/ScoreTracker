import { eq } from "drizzle-orm";
import { Context, Effect, Layer, PartitionedSemaphore } from "effect";
import { Database, DatabaseLive, type Db } from "../config/db";
import type { ScoreboardDTO } from "../dto/ScoreboardDTO";
import type { ScoreboardIntent } from "../dto/ScoreboardIntent";
import { InternalServerError, InvalidIntentError, NotFoundError } from "../errors/errors";
import { scoreboardsTable } from "../models/Scoreboard";
import { getScoreboardByCode, toScoreboardDTO } from "./scoreboardService";

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
  readonly applyIntentToCode: (
    code: string,
    intent: ScoreboardIntent,
  ) => Effect.Effect<ScoreboardDTO, NotFoundError | InternalServerError | InvalidIntentError>;
};

export class ScoreboardIntentService extends Context.Service<
  ScoreboardIntentService,
  ScoreboardIntentServiceInterface
>()("ScoreboardIntentService") {}

const INTENT_WRITES = PartitionedSemaphore.makeUnsafe<string>({ permits: 1 });

const nextUpdateTime = (previous: string): Date =>
  new Date(Math.max(Date.now(), Date.parse(previous) + 1));

export const applyIntentToCode =
  (db: Db) => (code: string, intent: ScoreboardIntent) =>
    PartitionedSemaphore.withPermit(INTENT_WRITES, code, Effect.gen(function* () {
      const current = yield* getScoreboardByCode(db)(code);

      const next = yield* applyIntent(current, intent);

      // The `.set()` is intentionally narrow (players only) and `updateTime` is server-computed monotonic.
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

export const ScoreboardIntentServiceLive = Layer.effect(
  ScoreboardIntentService,
  Effect.gen(function* () {
    const db = yield* Database;

    return ScoreboardIntentService.of({
      applyIntentToCode: applyIntentToCode(db),
    });
  }),
).pipe(Layer.provide(DatabaseLive));
