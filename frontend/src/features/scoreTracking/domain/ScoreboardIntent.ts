/**
 * Mirrors `ScoreboardIntent` in backend/dto/ScoreboardIntent.ts.
 *
 * Intents describe a *request* to change the board. The server computes the
 * resulting board and broadcasts it; the client never sends a score.
 *
 * `readonly` is carried over from the backend so the mirror stays exact: an
 * intent states what changed and is never edited in place afterwards.
 */
export type ScoreboardIntent =
  | { readonly type: "addScore"; readonly playerId: number; readonly amount: number }
  | { readonly type: "addPlayer"; readonly name: string }
  | { readonly type: "removePlayer"; readonly playerId: number };
