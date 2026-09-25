import { eq } from "drizzle-orm";
import { Context, Effect, Layer } from "effect";
import { Database, DatabaseLive, type Db } from "../config/db";
import type { ScoreboardDTO } from "../dto/ScoreboardDTO";
import type { ScoreboardIntent } from "../dto/ScoreboardIntent";
import { InternalServerError, InvalidIntentError, NotFoundError } from "../errors/errors";
import { scoreboardsTable } from "../models/Scoreboard";
import {
  ScoreboardService,
  ScoreboardServiceLive,
  toScoreboardDTO,
  type ScoreboardServiceInterface,
} from "./scoreboardService";

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

const applyIntentToCode =
  (db: Db, scoreboardService: ScoreboardServiceInterface) =>
  (code: string, intent: ScoreboardIntent) =>
    Effect.gen(function* () {
      const current = yield* scoreboardService.getScoreboardByCode(code);

      const next = yield* applyIntent(current, intent);

      // The write is deliberately narrower than a full-document replace: the
      // intent is the only authority on what changed, so nothing else is
      // written here. `updateTime` in particular must stay out of the `set` —
      // naming a column overrides its `$onUpdate(() => new Date())`, which
      // would leave the row's ordering token un-advanced and every client
      // would silently discard the broadcast.
      const updated = yield* Effect.tryPromise({
        try: () =>
          db
            .update(scoreboardsTable)
            .set({ players: next.players })
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
    });

export const ScoreboardIntentServiceLive = Layer.effect(
  ScoreboardIntentService,
  Effect.gen(function* () {
    const db = yield* Database;
    const scoreboardService = yield* ScoreboardService;

    return ScoreboardIntentService.of({
      applyIntentToCode: applyIntentToCode(db, scoreboardService),
    });
  }),
).pipe(Layer.provide(DatabaseLive), Layer.provide(ScoreboardServiceLive));
