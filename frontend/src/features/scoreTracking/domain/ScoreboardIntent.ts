export type ScoreboardIntent =
  | { readonly type: "addScore"; readonly playerId: number; readonly amount: number }
  | { readonly type: "addPlayer"; readonly name: string }
  | { readonly type: "removePlayer"; readonly playerId: number };
