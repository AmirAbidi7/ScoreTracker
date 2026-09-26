import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ConnectionStatus } from "./domain/ScoreboardService";
import type { Scoreboard } from "./domain/Scoreboard";

/** Load state for the leaderboard tab's own list, which no board event touches. */
export type BoardsStatus = "idle" | "loading" | "ready" | "error";

export interface ScoreboardState {
  current: Scoreboard | null;
  status: ConnectionStatus;
  error: string | null;
  pendingIntents: number;
  boards: Scoreboard[];
  boardsStatus: BoardsStatus;
}

const initialState: ScoreboardState = {
  current: null,
  status: "idle",
  error: null,
  pendingIntents: 0,
  boards: [],
  boardsStatus: "idle",
};

const scoreboardSlice = createSlice({
  name: "Scoreboard",
  initialState,
  reducers: {
    /**
     * The only way a board enters the store. Applies the server's canonical
     * board, so `updateScore`/`addPlayer`/`removePlayer` are NOT reducers —
     * they are thunks that send intents and wait for the broadcast.
     *
     * The `updateTime` guard is what makes ack-and-broadcast double delivery
     * safe: the sender may receive its own ack after another client's newer
     * broadcast, and applying that stale board would visibly rewind the score.
     * It is strictly `>`: an identical timestamp is a redelivery, not a newer
     * board, and the gateway does emit one redundantly on the first connect.
     */
    applyBoard: (state, action: PayloadAction<Scoreboard>) => {
      const incoming = action.payload;

      if (state.current === null) {
        state.current = incoming;
        return;
      }

      if (Date.parse(incoming.updateTime) > Date.parse(state.current.updateTime)) {
        state.current = incoming;
      }
    },

    /** A new status is newer news than the failure that preceded it. */
    setStatus: (state, action: PayloadAction<ConnectionStatus>) => {
      state.status = action.payload;
      state.error = null;
    },

    setError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
    },

    intentStarted: (state) => {
      state.pendingIntents += 1;
    },

    /**
     * Clamped, because an intent can settle without a matching start: a
     * rejected ack, or a timeout that fires after the start was already
     * accounted for. A negative count renders as a spinner that never clears.
     */
    intentSettled: (state) => {
      state.pendingIntents = Math.max(0, state.pendingIntents - 1);
    },

    setBoards: (state, action: PayloadAction<Scoreboard[]>) => {
      state.boards = action.payload;
    },

    setBoardsStatus: (state, action: PayloadAction<BoardsStatus>) => {
      state.boardsStatus = action.payload;
    },

    /**
     * Leaving a board. `boards` and `boardsStatus` survive: that list is the
     * leaderboard tab's data and says nothing about which board is open.
     * Nulling `current` is also what lets a board older than the current one be
     * applied afterwards — the ordering guard only ever moves forward.
     */
    resetScoreboard: (state) => {
      state.current = null;
      state.status = "idle";
      state.error = null;
      state.pendingIntents = 0;
    },
  },
});

export const {
  applyBoard,
  setStatus,
  setError,
  intentStarted,
  intentSettled,
  setBoards,
  setBoardsStatus,
  resetScoreboard,
} = scoreboardSlice.actions;

/** Also the default export, which is what `store/index.ts` imports. */
export const scoreboardReducer = scoreboardSlice.reducer;

export default scoreboardReducer;
