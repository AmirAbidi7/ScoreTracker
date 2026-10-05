import { createSlice, type Action, type PayloadAction } from "@reduxjs/toolkit";
import type { ConnectionStatus } from "./domain/ScoreboardService";
import type { Scoreboard } from "./domain/Scoreboard";
import { rejectionReason } from "./rejectionReason";

export type BoardsStatus = "idle" | "loading" | "ready" | "error";

const INTENT_FULFILLED = "scoreboard/intent/fulfilled";
const INTENT_REJECTED = "scoreboard/intent/rejected";
const RESTORE_REJECTED = "scoreboard/restore/rejected";
const LEAVE_REJECTED = "scoreboard/leave/rejected";
const DELETE_REJECTED = "scoreboard/delete/rejected";
const CLAIM_REJECTED = "scoreboard/claim/rejected";

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
    applyBoard: (state, action: PayloadAction<Scoreboard>) => {
      const incoming = action.payload;

      if (state.current === null || incoming.id !== state.current.id) {
        state.current = incoming;
        return;
      }

      if (Date.parse(incoming.updateTime) > Date.parse(state.current.updateTime)) {
        state.current = incoming;
      }
    },

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

    intentSettled: (state) => {
      state.pendingIntents = Math.max(0, state.pendingIntents - 1);
    },

    setBoards: (state, action: PayloadAction<Scoreboard[]>) => {
      state.boards = action.payload;
    },

    setBoardsStatus: (state, action: PayloadAction<BoardsStatus>) => {
      state.boardsStatus = action.payload;
    },

    resetScoreboard: (state) => {
      state.current = null;
      state.status = "idle";
      state.error = null;
      state.pendingIntents = 0;
    },
  },

  // `updateTime` ordering and the payload-first rejection policy are deliberate; see `rejectionReason.ts`.
  extraReducers: (builder) => {
    builder
      .addCase(INTENT_FULFILLED, (state) => {
        state.error = null;
      })
      .addCase(
        INTENT_REJECTED,
        (state, action: PayloadAction<string> & Action<typeof INTENT_REJECTED>) => {
          const message = rejectionReason(action);
          if (message !== null) state.error = message;
        },
      )
      .addCase(
        RESTORE_REJECTED,
        (state, action: PayloadAction<string> & Action<typeof RESTORE_REJECTED>) => {
          const message = rejectionReason(action);
          if (message !== null) state.error = message;
        },
      )
      .addCase(
        LEAVE_REJECTED,
        (state, action: PayloadAction<string> & Action<typeof LEAVE_REJECTED>) => {
          const message = rejectionReason(action);
          if (message !== null) state.error = message;
        },
      )
      .addCase(
        DELETE_REJECTED,
        (state, action: PayloadAction<string> & Action<typeof DELETE_REJECTED>) => {
          const message = rejectionReason(action);
          if (message !== null) state.error = message;
        },
      )
      .addCase(
        CLAIM_REJECTED,
        (state, action: PayloadAction<string> & Action<typeof CLAIM_REJECTED>) => {
          const message = rejectionReason(action);
          if (message !== null) state.error = message;
        },
      );
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

export const scoreboardReducer = scoreboardSlice.reducer;

export default scoreboardReducer;
