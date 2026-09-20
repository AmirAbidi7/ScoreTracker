import type { Player } from "../models/Scoreboard";

export interface ScoreboardCreateRequest {
  id: string;
  gameName: string;
}

export interface ScoreboardDTO {
  id: number;
  gameName: string;
  players: Player[];
}
