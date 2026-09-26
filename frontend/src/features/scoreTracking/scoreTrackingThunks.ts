import { createAsyncThunk } from "@reduxjs/toolkit";
import { ApiClientError } from "../../../infrastructure/api/client";
import { scoreboardService } from "./domain/ScoreboardService";
import type { ScoreboardIntent } from "./domain/ScoreboardIntent";
import { clearSavedSession, readSavedSession, writeSavedSession } from "./domain/ScoreboardSession";
import {
  applyBoard,
  intentSettled,
  intentStarted,
  resetScoreboard,
  setBoards,
  setBoardsStatus,
  setError,
  setStatus,
} from "./scoreTrackingSlice";

/**
 * Every failure the user can be shown, in one place.
 *
 * `isOffline` and a 404 are separated because they demand different words: the
 * first means the request never left the device and the server may be perfectly
 * healthy, the second means it did and the answer was no. Collapsing them into
 * `error.message` would put a raw transport string in front of the user for one
 * and a backend's own wording for the other.
 */
const describeError = (error: unknown): string => {
  if (error instanceof ApiClientError) {
    if (error.isOffline) return "Can't reach the server";
    if (error.status === 404) return "No scoreboard with that code";
    return error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong";
};

/**
 * Normalised here rather than at the input, because a thunk that only works
 * from one screen is not safe: a pasted code, a restored one, and a deep link
 * must all reach the server in the shape it generates (`[a-z0-9]{6}`).
 */
const normalizeCode = (rawCode: string): string => rawCode.trim().toUpperCase();

export const joinScoreboard = createAsyncThunk(
  "scoreboard/join",
  async (rawCode: string, { dispatch, rejectWithValue }) => {
    const code = normalizeCode(rawCode);

    if (code.length !== 6) {
      return rejectWithValue("A scoreboard code is 6 characters");
    }

    try {
      const board = await scoreboardService.joinScoreboard(code);
      await writeSavedSession({ id: board.id, code: board.code });
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
      await writeSavedSession({ id: board.id, code: board.code });
      dispatch(applyBoard(board));
      dispatch(setStatus("connected"));
      return board;
    } catch (error) {
      return rejectWithValue(describeError(error));
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
      return rejectWithValue(describeError(error));
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
  async (_, { dispatch }) => {
    await scoreboardService.leaveScoreboard();
    await clearSavedSession();
    dispatch(resetScoreboard());
  },
);

export const deleteCurrentScoreboard = createAsyncThunk(
  "scoreboard/delete",
  async (_, { dispatch, rejectWithValue }) => {
    try {
      await scoreboardService.deleteCurrentScoreboard();
      await clearSavedSession();
      dispatch(resetScoreboard());
    } catch (error) {
      return rejectWithValue(describeError(error));
    }
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
        // forever against a board that no longer exists.
        await clearSavedSession();
        dispatch(resetScoreboard());
        return null;
      }
      return rejectWithValue(describeError(error));
    }
  },
);
