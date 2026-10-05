export interface Player {
  id: number;
  name: string;
  score: number;
}

export interface Scoreboard {
  id: string;
  gameName: string;
  code: string;
  players: Player[];
  updateTime: string;
  ownerId: string | null;
}
