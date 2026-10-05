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

const describeError = (error: unknown, notFound = "No scoreboard with that code"): string => {
  if (error instanceof ApiClientError) {
    if (error.status === 404) return notFound;
    if (error.failure === "unencodable-value") return error.message;
    return error.isOffline ? "Can't reach the server" : error.message;
  }
  return error instanceof Error ? error.message : "Something went wrong";
};

const normalizeCode = (rawCode: string): string => rawCode.trim().toUpperCase();

const saveSession = async (board: Scoreboard): Promise<void> => {
  await writeSavedSession({ id: board.id, code: board.code }).catch(() => {});
};

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

export const sendIntent = createAsyncThunk(
  "scoreboard/intent",
  async (intent: ScoreboardIntent, { dispatch, rejectWithValue }) => {
    dispatch(intentStarted());
    try {
      const ack = await scoreboardService.sendIntent(intent);
      if (ack.ok === "superseded") {
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
      return rejectWithValue(describeError(error, "That scoreboard has already been deleted"));
    }
    await forgetSession(dispatch);
  },
);

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
        await forgetSession(dispatch);
        return null;
      }
      return rejectWithValue(describeError(error));
    }
  },
);
