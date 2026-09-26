import { createAsyncThunk, type ThunkDispatch, type UnknownAction } from "@reduxjs/toolkit";
import { ApiClientError } from "../../../infrastructure/api/client";
import { scoreboardService } from "./domain/ScoreboardService";
import type { Scoreboard } from "./domain/Scoreboard";
import type { ScoreboardIntent } from "./domain/ScoreboardIntent";
import { clearSavedSession, readSavedSession, writeSavedSession } from "./domain/ScoreboardSession";
import {
  applyBoard,
  intentSettled,
  intentStarted,
  resetScoreboard,
  setBoards,
  setBoardsStatus,
  setStatus,
} from "./scoreTrackingSlice";

/**
 * Every failure the user can be shown, in one place.
 *
 * A 404 is the one failure the user can act on by typing a different code, and
 * no backend is likely to word it that way, so it gets its own sentence — a
 * different one per call site, because "no scoreboard with that code" is
 * nonsense as the answer to "delete this board" or "list the boards".
 *
 * Then the two `status === 0` cases, which `isOffline` alone cannot separate
 * because both are genuinely "never reached the server" and the status has to
 * keep meaning that for every consumer. `ApiClientError.failure` is what tells
 * them apart:
 *
 * - `"transport"` is a dead network or a downed backend, and the user gets
 *   "Can't reach the server". The client's own message is not used here: it
 *   substitutes that string only when the cause carries none, and a real React
 *   Native `fetch` rejection always carries one — "Network request failed" on
 *   Android, "Load failed" on iOS. Passing those through would put a raw
 *   platform string in front of the user on the most common failure there is.
 * - `"unencodable-value"` is a code this client refused to put in a URL, so
 *   nothing was ever sent. Blaming the network is a false diagnosis here, and
 *   the message is the only useful thing left to show.
 *
 * A tag rather than a comparison on the message text, so rewording a message
 * cannot silently change which failures are called offline.
 */
const describeError = (error: unknown, notFound = "No scoreboard with that code"): string => {
  if (error instanceof ApiClientError) {
    if (error.status === 404) return notFound;
    if (error.failure === "unencodable-value") return error.message;
    return error.isOffline ? "Can't reach the server" : error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong";
};

/**
 * Normalised here rather than at the input, because a thunk that only works
 * from one screen is not safe: a pasted code, a restored one, and a deep link
 * must all reach the server in the shape it generates (`[a-z0-9]{6}`). Before
 * the length check, not after: `" ab12cd "` is a six-character code with
 * padding, and `"  ab12  "` is a four-character code.
 */
const normalizeCode = (rawCode: string): string => rawCode.trim().toUpperCase();

/**
 * Remembers which board to come back to, best effort.
 *
 * The board is already accepted server-side and already in the store by the
 * time this runs, so a storage failure costs a convenience pointer and nothing
 * else. Letting it reject would report a join that actually succeeded as
 * failed, and — because nothing was saved — drop the user back on the Join
 * screen at the next cold start, having thrown away a board that exists.
 */
const saveSession = async (board: Scoreboard): Promise<void> => {
  await writeSavedSession({ id: board.id, code: board.code }).catch(() => {});
};

/**
 * Leaves the board for good: the store first, then the saved pointer.
 *
 * The order is the whole point, and it is not cosmetic. `clearSavedSession` is
 * `AsyncStorage.removeItem`, and that rejects when storage fails — so clear
 * first, and a rejection skips the reset entirely. That strands `current` on a
 * board the service has already left, and in `restoreSession`'s 404 arm it
 * strands `status: "connecting"` for the lifetime of the process with the
 * session still in storage, so the next cold start runs the same 404 again:
 * the retry loop that arm exists to break.
 *
 * The clear is best effort for the same reason `useScoreboardSync` treats its
 * own that way: a failed delete leaves one stale entry, which the next
 * successful write replaces, and it must not reject a thunk whose state is
 * already correct.
 */
const forgetSession = async (
  dispatch: ThunkDispatch<unknown, unknown, UnknownAction>,
): Promise<void> => {
  dispatch(resetScoreboard());
  await clearSavedSession().catch(() => {});
};

export const joinScoreboard = createAsyncThunk(
  "scoreboard/join",
  async (rawCode: string, { dispatch, rejectWithValue }) => {
    const code = normalizeCode(rawCode);

    if (code.length !== 6) {
      return rejectWithValue("A scoreboard code is 6 characters");
    }

    try {
      const board = await scoreboardService.joinScoreboard(code);
      await saveSession(board);
      dispatch(applyBoard(board));
      dispatch(setStatus("connected"));
      return board;
    } catch (error) {
      return rejectWithValue(describeError(error));
    }
  },
);

export const createScoreboard = createAsyncThunk(
  "scoreboard/create",
  async (gameName: string, { dispatch, rejectWithValue }) => {
    const trimmed = gameName.trim();
    if (trimmed.length === 0) return rejectWithValue("Give the game a name");

    try {
      const board = await scoreboardService.createScoreboard(trimmed);
      await saveSession(board);
      dispatch(applyBoard(board));
      dispatch(setStatus("connected"));
      return board;
    } catch (error) {
      return rejectWithValue(describeError(error, "Couldn't create the scoreboard"));
    }
  },
);

export const loadScoreboards = createAsyncThunk(
  "scoreboard/loadAll",
  async (_, { dispatch, rejectWithValue }) => {
    dispatch(setBoardsStatus("loading"));
    try {
      const boards = await scoreboardService.listScoreboards();
      dispatch(setBoards(boards));
      dispatch(setBoardsStatus("ready"));
      return boards;
    } catch (error) {
      dispatch(setBoardsStatus("error"));
      return rejectWithValue(describeError(error, "Couldn't load scoreboards"));
    }
  },
);

/**
 * Sends an intent and waits for the server to confirm. Deliberately does NOT
 * touch `current` — the board moves only when the server's board comes back
 * through `applyBoard`, whether that arrives as this ack or as the broadcast
 * that follows it. That is the whole point of server-authoritative state: there
 * is no optimistic value to reconcile and nothing to roll back, so a rejected
 * intent needs no undo because the number never moved.
 */
export const sendIntent = createAsyncThunk(
  "scoreboard/intent",
  async (intent: ScoreboardIntent, { dispatch, rejectWithValue }) => {
    dispatch(intentStarted());
    try {
      const ack = await scoreboardService.sendIntent(intent);
      if (ack.ok === "superseded") {
        // The server applied it — to a game this device has left, which is why the
        // service did not hand the board over (see `ScoreboardService.sendIntent`).
        // Nothing to apply and nothing to apologise for: the board on screen is
        // untouched, and the score the user asked for went to the game they walked
        // away from. Resolved rather than rejected so it is not reported as a
        // failure of the game in front of them.
        return ack.board;
      }
      if (ack.ok) {
        dispatch(applyBoard(ack.scoreboard));
        return ack.scoreboard;
      }
      return rejectWithValue(ack.message);
    } catch (error) {
      return rejectWithValue(describeError(error));
    } finally {
      // In `finally` and not on the success path alone: a rejection settles the
      // intent too, and leaving the counter up would spin the UI forever.
      dispatch(intentSettled());
    }
  },
);

export const leaveScoreboard = createAsyncThunk(
  "scoreboard/leave",
  async (_, { dispatch, rejectWithValue }) => {
    try {
      await scoreboardService.leaveScoreboard();
    } catch (error) {
      // The board is still open, so the store keeps it: reporting the failure
      // is all that is owed. Resetting here would leave a user who is still in
      // the room with no board on screen.
      return rejectWithValue(describeError(error));
    }
    await forgetSession(dispatch);
  },
);

export const deleteCurrentScoreboard = createAsyncThunk(
  "scoreboard/delete",
  async (_, { dispatch, rejectWithValue }) => {
    try {
      await scoreboardService.deleteCurrentScoreboard();
    } catch (error) {
      // A failed delete is the caller's to handle: the board still exists, so
      // the room and the tracked code are left alone and only the failure is
      // reported. A 404 means somebody else got there first, which is the one
      // delete failure the user can do nothing about.
      return rejectWithValue(describeError(error, "That scoreboard has already been deleted"));
    }
    await forgetSession(dispatch);
  },
);

/**
 * Rejoin on cold start. The board may have been deleted while the app was
 * closed, so a 404 clears the saved session instead of looping forever on a
 * board that no longer exists.
 *
 * Nothing is written back on success: the session is already in storage, and
 * rewriting what was just read would only risk replacing a good pointer.
 */
export const restoreSession = createAsyncThunk(
  "scoreboard/restore",
  async (_, { dispatch, rejectWithValue }) => {
    const saved = await readSavedSession();
    if (!saved) return null;

    dispatch(setStatus("connecting"));
    try {
      const board = await scoreboardService.joinScoreboard(normalizeCode(saved.code));
      dispatch(applyBoard(board));
      dispatch(setStatus("connected"));
      return board;
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404) {
        // Deleted while the app was closed. Forget it rather than retrying
        // forever against a board that no longer exists — and forget the store
        // before the storage call, so a storage failure here cannot re-arm
        // this same 404 on the next launch.
        await forgetSession(dispatch);
        return null;
      }
      return rejectWithValue(describeError(error));
    }
  },
);
