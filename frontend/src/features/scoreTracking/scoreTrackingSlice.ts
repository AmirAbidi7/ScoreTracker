import { createSlice, type Action, type PayloadAction } from "@reduxjs/toolkit";
import type { ConnectionStatus } from "./domain/ScoreboardService";
import type { Scoreboard } from "./domain/Scoreboard";

/** Load state for the leaderboard tab's own list, which no board event touches. */
export type BoardsStatus = "idle" | "loading" | "ready" | "error";

/**
 * The outcome types this slice reacts to, from the two thunks whose failure a
 * user has to be told about. Written out here rather than imported from
 * `scoreTrackingThunks` — see the note on `extraReducers` for why importing them
 * is not an option.
 */
const INTENT_FULFILLED = "scoreboard/intent/fulfilled";
const INTENT_REJECTED = "scoreboard/intent/rejected";
const DELETE_REJECTED = "scoreboard/delete/rejected";

/** A message is worth showing only if there is something in it. */
const isAMessage = (candidate: unknown): candidate is string =>
  typeof candidate === "string" && candidate.trim().length > 0;

/**
 * What a rejected action has to say, or `null` when it says nothing.
 *
 * `rejectWithValue` — which every thunk here does — carries the reason in
 * `payload`. A thunk that *threw* instead carries none there and puts the reason
 * on `error.message`, so that is read, and it is read second for a reason: RTK
 * builds `error` as `miniSerializeError(error || "Rejected")`, so a payload that
 * is present but empty leaves a *placeholder* on `error.message` rather than a
 * real one. Falling through to it would answer a thunk's empty `rejectWithValue`
 * with the word "Rejected" on the scoreboard.
 *
 * A payload that is present but says nothing is therefore answered with nothing
 * at all, and the previous error is left as it was. Same for a message that is
 * empty: storing `""` in a `string | null` field renders an empty red banner,
 * which is the same silence this helper exists to prevent, one layer down.
 */
const rejectionMessage = (action: {
  payload?: unknown;
  error?: { message?: string };
}): string | null => {
  if (action.payload !== undefined) {
    return isAMessage(action.payload) ? action.payload : null;
  }
  return isAMessage(action.error?.message) ? action.error.message : null;
};

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

  /**
   * What the thunks rejected with, kept so that the user is told.
   *
   * Without this, a refused change is completely silent: the pending banner
   * clears, the score does not move, and the connection banner says nothing
   * because the socket is fine. The gateway emits its own `error` events only
   * for a failed connect or a failed re-read — never for an intent the server
   * turned down — so nothing else in the app would ever put this on screen. A
   * failed delete is worse still: the user agreed to something irreversible,
   * watched the board stay, and was given no reason.
   *
   * `intent/fulfilled` is here to stop a failure sticking. `error` is cleared
   * nowhere else except `setStatus`, and the gateway reports a status only on
   * connect, reconnect and disconnect — never per intent. So a refused `+4`
   * would otherwise leave its red line on screen while a *later* `+4` moved the
   * score, with nothing the user can do to clear it: a message that has stopped
   * being true and cannot be dismissed. A change that went through is newer
   * news about this board, which is the same rule `setStatus` already follows.
   *
   * `delete/fulfilled` gets no case, and needs none: a successful delete resets
   * the whole board away, and `resetScoreboard` nulls `error` on its way out.
   * A case there would be a second path to a state the reset already reaches.
   *
   * The type strings are written out rather than imported from
   * `scoreTrackingThunks`, which is what would tie them to the action creators
   * that produce them. The thunks import this module, so importing them back
   * closes a cycle whose evaluation order then decides whether `addCase` sees a
   * defined creator or one still in its temporal dead zone — a module-load
   * crash that depends on which file a future edit happens to import first. The
   * slice's tests dispatch the real `fulfilled` and `rejected` creators, so a
   * renamed or re-prefixed thunk fails there instead of going silently
   * unreported.
   *
   * `addCase` given a type string infers a bare `Action`, which carries no
   * `payload`; the `& Action<…>` on each rejection is what lets it read one.
   */
  extraReducers: (builder) => {
    builder
      .addCase(INTENT_FULFILLED, (state) => {
        state.error = null;
      })
      .addCase(
        INTENT_REJECTED,
        (state, action: PayloadAction<string> & Action<typeof INTENT_REJECTED>) => {
          const message = rejectionMessage(action);
          if (message !== null) state.error = message;
        },
      )
      .addCase(
        DELETE_REJECTED,
        (state, action: PayloadAction<string> & Action<typeof DELETE_REJECTED>) => {
          const message = rejectionMessage(action);
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

/** Also the default export, which is what `store/index.ts` imports. */
export const scoreboardReducer = scoreboardSlice.reducer;

export default scoreboardReducer;
