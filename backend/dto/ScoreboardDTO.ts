import type { Player } from "../models/Scoreboard";

export interface ScoreboardCreateRequest {
  id: string;
  gameName: string;
}

export interface ScoreboardDTO {
  id: string;
  gameName: string;
  code: string;
  players: Player[];
  /**
   * ISO 8601. Used by clients to discard out-of-order broadcasts: a board is
   * only applied if its updateTime is strictly newer than the current one.
   */
  updateTime: string;
}
