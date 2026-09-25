/**
 * Mirrors `ScoreboardIntent` in backend/dto/ScoreboardIntent.ts.
 *
 * Intents describe a *request* to change the board. The server computes the
 * resulting board and broadcasts it; the client never sends a score.
 */
export type ScoreboardIntent =
  | { type: "addScore"; playerId: number; amount: number }
  | { type: "addPlayer"; name: string }
  | { type: "removePlayer"; playerId: number };
