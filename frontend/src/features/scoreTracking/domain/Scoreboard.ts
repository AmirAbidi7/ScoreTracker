interface Player {
  name: string;
  score: number;
}

interface Scoreboard {
  id: number;
  gameName: string;
  players: Player[];
}

export { Player, Scoreboard };
