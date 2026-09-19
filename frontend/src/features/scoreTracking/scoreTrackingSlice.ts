import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { scores } from "../../../constants/data";
import { Player, Scoreboard } from "./domain/Scoreboard";

interface ScoreboardState {
  value: Scoreboard;
}

const initialState: ScoreboardState = {
  value: scores,
};

const scoreboardSlice = createSlice({
  name: "Scoreboard",
  initialState,
  reducers: {
    updateScore: (state, action: PayloadAction<{ playerId: number; amount: number }>) => {
      const player = state.value.players.find((p) => p.id == action.payload.playerId);

      if (player) {
        player.score += action.payload.amount;
      }
    },

    addPlayer: (state, action: PayloadAction<string>) => {
      const lastPlayer = state.value.players[state.value.players.length - 1];
      state.value.players.push({
        id: lastPlayer ? lastPlayer.id + 1 : 1,
        name: action.payload,
        score: 0,
      });
    },

    removePlayer: (state, action: PayloadAction<number>) => {
      state.value.players = state.value.players.filter((p) => p.id !== action.payload);
    },
  },
});

export const { updateScore, addPlayer, removePlayer } = scoreboardSlice.actions;
export default scoreboardSlice.reducer;
