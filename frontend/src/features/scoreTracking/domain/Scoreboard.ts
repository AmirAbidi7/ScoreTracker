/** Mirrors `Player` in backend/models/Scoreboard.ts. */
export interface Player {
  id: number;
  name: string;
  score: number;
}

/**
 * Mirrors `ScoreboardDTO` in backend/dto/ScoreboardDTO.ts.
 *
 * `id` is a UUID string, not a number — the previous `id: number` never
 * matched the backend. `updateTime` is the ordering token: a board is only
 * applied if it is strictly newer than the one already held.
 */
export interface Scoreboard {
  id: string;
  gameName: string;
  code: string;
  players: Player[];
  updateTime: string;
}
