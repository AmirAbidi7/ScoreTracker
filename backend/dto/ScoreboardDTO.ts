import type { Player } from "../models/Scoreboard";

export interface ScoreboardCreateRequest {
  id: string;
  gameName: string;
}

export interface ScoreboardDTO {
  id: string;
  gameName: string;
  players: Player[];
}
