import { createSlice, type Action, type PayloadAction } from "@reduxjs/toolkit";
import type { ConnectionStatus } from "./domain/ScoreboardService";
import type { Scoreboard } from "./domain/Scoreboard";
import { rejectionReason } from "./rejectionReason";

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
     * A board with a *different* `id` is the user switching games, and it is
     * applied unconditionally. Ordering is a statement about one board, and it
     * was read as a statement about all of them: joining an older board from the
     * leaderboard was silently dropped, and the screen kept showing the previous
     * game while the gateway had already switched `current`, joined the new room
     * and written the new session. `sendIntent` then posts this board's
     * `playerId` to the new board's `code` — and player ids restart at 1 per
     * board, so they collide and the taps *succeed* on the wrong game, looking
     * entirely correct to the user.
     *
     * Nothing can be stranded by trusting the switch: `teardown` detaches the old
     * socket's handlers before disconnecting, so once the new board is on its way
     * no further broadcast from the previous one can be emitted, and a
     * re-read still in flight is refused by `stillTracking` on the board id.
     *
     * Within one board the `updateTime` guard is what makes ack-and-broadcast
     * double delivery safe: the sender may receive its own ack after another
     * client's newer broadcast, and applying that stale board would visibly
     * rewind the score. It is strictly `>`: an identical timestamp is a
     * redelivery, not a newer board, and the gateway does emit one redundantly
     * on the first connect.
     */
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
     * Nulling `current` is not what makes another board appliable — `applyBoard`
     * switches on a differing id — but it is what leaves the store honest about
     * there being no board at all, which is what the empty state renders.
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
   *
   * What to make of that action is `rejectionReason`, which lives outside this
   * module because two pages ask the same question and each was reading it its
   * own way — and the ways did not agree. The payload-first order is not a
   * detail: read from `error` first, a perfectly good `rejectWithValue` message
   * is answered with RTK's "Rejected" placeholder.
   */
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
        DELETE_REJECTED,
        (state, action: PayloadAction<string> & Action<typeof DELETE_REJECTED>) => {
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

/** Also the default export, which is what `store/index.ts` imports. */
export const scoreboardReducer = scoreboardSlice.reducer;

export default scoreboardReducer;
