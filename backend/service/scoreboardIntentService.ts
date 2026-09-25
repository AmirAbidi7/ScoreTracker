import { Effect } from "effect";
import type { ScoreboardDTO } from "../dto/ScoreboardDTO";
import type { ScoreboardIntent } from "../dto/ScoreboardIntent";
import { InvalidIntentError } from "../errors/errors";

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
