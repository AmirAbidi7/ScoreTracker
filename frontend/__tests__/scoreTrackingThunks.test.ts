/// <reference types="jest" />
import { configureStore } from "@reduxjs/toolkit";
import { ApiClientError } from "../infrastructure/api/client";
import type { Scoreboard } from "../src/features/scoreTracking/domain/Scoreboard";
import { scoreboardService, type ScoreboardService } from "../src/features/scoreTracking/domain/ScoreboardService";
import {
  clearSavedSession,
  readSavedSession,
  writeSavedSession,
} from "../src/features/scoreTracking/domain/ScoreboardSession";
import reducer, { applyBoard } from "../src/features/scoreTracking/scoreTrackingSlice";
import {
  deleteCurrentScoreboard,
  joinScoreboard,
  leaveScoreboard,
  loadScoreboards,
  restoreSession,
  sendIntent,
} from "../src/features/scoreTracking/scoreTrackingThunks";
import type { ScoreboardAck } from "../infrastructure/socket/scoreboardSocket";

/**
 * Both modules are mocked wholesale. `ScoreboardService` is mocked rather than
 * constructed because these tests are about what the thunks do with a result,
 * and a real service would need a real socket; its exported *types* are erased
 * at runtime, so mocking the value leaves the slice's `ConnectionStatus`
 * import intact.
 */
jest.mock("../src/features/scoreTracking/domain/ScoreboardService", () => ({
  scoreboardService: {
    joinScoreboard: jest.fn(),
    createScoreboard: jest.fn(),
    listScoreboards: jest.fn(),
    leaveScoreboard: jest.fn(),
    deleteCurrentScoreboard: jest.fn(),
    sendIntent: jest.fn(),
    subscribe: jest.fn(() => () => {}),
  },
}));

jest.mock("../src/features/scoreTracking/domain/ScoreboardSession", () => ({
  readSavedSession: jest.fn(),
  writeSavedSession: jest.fn(),
  clearSavedSession: jest.fn(),
}));

const service = scoreboardService as jest.Mocked<ScoreboardService>;
const readSession = readSavedSession as jest.MockedFunction<typeof readSavedSession>;
const writeSession = writeSavedSession as jest.MockedFunction<typeof writeSavedSession>;
const clearSession = clearSavedSession as jest.MockedFunction<typeof clearSavedSession>;

const board: Scoreboard = {
  id: "board-1",
  gameName: "Catan",
  code: "AB12CD",
  players: [{ id: 1, name: "Amir", score: 3 }],
  updateTime: "2026-09-25T10:00:00.000Z",
};

const makeStore = () => configureStore({ reducer: { scoreboard: reducer } });
type TestStore = ReturnType<typeof makeStore>;

const state = (store: TestStore) => store.getState().scoreboard;

/**
 * Real storage promises in `beforeEach`, not bare `jest.fn()`s. The thunks call
 * `.catch()` on the result of both session helpers, and a mock returning
 * `undefined` would fail on that rather than on anything worth testing.
 */
beforeEach(() => {
  jest.clearAllMocks();
  readSession.mockResolvedValue(null);
  writeSession.mockResolvedValue(undefined);
  clearSession.mockResolvedValue(undefined);
});

describe("restoreSession: the board is gone", () => {
  const notFound = () => new ApiClientError("Scoreboard not found", 404);

  beforeEach(() => {
    readSession.mockResolvedValue({ id: "board-1", code: "ab12cd" });
    service.joinScoreboard.mockRejectedValue(notFound());
  });

  it("clears the session and lands on idle, not connecting", async () => {
    const store = makeStore();

    const action = await store.dispatch(restoreSession());

    expect(action.type).toBe("scoreboard/restore/fulfilled");
    expect(state(store).status).toBe("idle");
    expect(state(store).status).not.toBe("connecting");
    expect(state(store).current).toBeNull();
    expect(clearSession).toHaveBeenCalledTimes(1);
  });

  it("lands on idle even when clearing the session fails", async () => {
    // The regression this whole arm exists to avoid: `setStatus("connecting")`
    // has already run, and the 404 arm's only route back to "idle" is the
    // reset. Clearing storage before resetting would let a rejection skip it
    // and leave the status stuck for the lifetime of the process, with the
    // session still in storage to repeat the same 404 on the next cold start.
    clearSession.mockRejectedValue(new Error("storage is full"));
    const store = makeStore();

    await store.dispatch(restoreSession());

    expect(state(store).status).toBe("idle");
    expect(state(store).status).not.toBe("connecting");
    expect(state(store).current).toBeNull();
  });

  it("rejoins with the normalised code, not the raw stored one", async () => {
    await makeStore().dispatch(restoreSession());

    expect(service.joinScoreboard).toHaveBeenCalledWith("AB12CD");
  });

  it("keeps the session and rejects when the failure is not a 404", async () => {
    service.joinScoreboard.mockRejectedValue(new ApiClientError("Bad gateway", 502));
    const store = makeStore();

    const action = await store.dispatch(restoreSession());

    expect(action.type).toBe("scoreboard/restore/rejected");
    expect(clearSession).not.toHaveBeenCalled();
  });
});

describe("sendIntent: the pending counter always settles", () => {
  const intent = { type: "addScore", playerId: 1, amount: 2 } as const;

  it("is pending while the server decides, and back to 0 after a rejection", async () => {
    let release!: (ack: ScoreboardAck) => void;
    service.sendIntent.mockReturnValue(
      new Promise<ScoreboardAck>((resolve) => {
        release = resolve;
      }),
    );
    const store = makeStore();

    const sent = store.dispatch(sendIntent(intent));
    expect(state(store).pendingIntents).toBe(1);

    release({ ok: false, code: 400, message: "No such player" });
    await sent;

    expect(state(store).pendingIntents).toBe(0);
  });

  it("settles when sending throws rather than leaking the counter", async () => {
    service.sendIntent.mockRejectedValue(new Error("socket exploded"));
    const store = makeStore();

    await store.dispatch(sendIntent(intent));

    expect(state(store).pendingIntents).toBe(0);
  });

  it("settles to exactly 0 with several intents in flight at once", async () => {
    service.sendIntent.mockResolvedValue({ ok: false, code: 400, message: "No" });
    const store = makeStore();

    await Promise.all([
      store.dispatch(sendIntent(intent)),
      store.dispatch(sendIntent(intent)),
      store.dispatch(sendIntent(intent)),
    ]);

    expect(state(store).pendingIntents).toBe(0);
  });
});

describe("sendIntent: a rejected intent never moves the board", () => {
  it("leaves the score exactly where it was", async () => {
    service.sendIntent.mockResolvedValue({ ok: false, code: 404, message: "No such player" });
    const store = makeStore();
    store.dispatch(applyBoard(board));

    const action = await store.dispatch(
      sendIntent({ type: "addScore", playerId: 1, amount: 99 }),
    );

    expect(action.type).toBe("scoreboard/intent/rejected");
    // Not "eventually" equal: the whole point is that no value was ever
    // written, so there is nothing to reconcile and nothing to roll back.
    expect(state(store).current).toEqual(board);
    expect(state(store).current?.players[0].score).toBe(3);
  });
});

describe("describeError", () => {
  it("surfaces the URL-encoding message for a code the client cannot send", async () => {
    // Six UTF-16 units, so it clears the length check, and it carries an
    // unpaired surrogate, so `encodePathSegment` throws before the request is
    // built. That error is `status: 0` — the same status as being offline —
    // and telling the user the server is unreachable would blame the network
    // for their own input and discard the only diagnostic.
    const unencodable = "\ud800abcde";
    expect(unencodable).toHaveLength(6);
    // What the client would really be handed: the code survives `normalizeCode`,
    // uppercased, surrogate and all.
    const normalized = "\ud800ABCDE";
    const encodingMessage = `Cannot build a request URL from ${JSON.stringify(normalized)}`;
    service.joinScoreboard.mockRejectedValue(new ApiClientError(encodingMessage, 0));
    const store = makeStore();

    const action = await store.dispatch(joinScoreboard(unencodable));

    expect(action.type).toBe("scoreboard/join/rejected");
    expect(action.payload).not.toBe("Can't reach the server");
    expect(action.payload).toBe(encodingMessage);
    expect(service.joinScoreboard).toHaveBeenCalledWith(normalized);
  });

  it("keeps the client's own wording for a genuine transport failure", async () => {
    service.joinScoreboard.mockRejectedValue(new ApiClientError("Can't reach the server", 0));
    const store = makeStore();

    const action = await store.dispatch(joinScoreboard("ab12cd"));

    expect(action.payload).toBe("Can't reach the server");
  });

  it("does not tell a user deleting a board that no board has that code", async () => {
    service.deleteCurrentScoreboard.mockRejectedValue(new ApiClientError("Not found", 404));
    const store = makeStore();

    const action = await store.dispatch(deleteCurrentScoreboard());

    expect(action.type).toBe("scoreboard/delete/rejected");
    expect(action.payload).toBe("That scoreboard has already been deleted");
    expect(action.payload).not.toBe("No scoreboard with that code");
  });

  it("does not tell a user loading the list that no board has that code", async () => {
    service.listScoreboards.mockRejectedValue(new ApiClientError("Not found", 404));
    const store = makeStore();

    const action = await store.dispatch(loadScoreboards());

    expect(action.payload).toBe("Couldn't load scoreboards");
    expect(state(store).boardsStatus).toBe("error");
  });
});

describe("the session pointer is best effort", () => {
  it("does not report a failed join when only saving the session failed", async () => {
    // The board was accepted server-side and is already in the store, so
    // rejecting here would report a success as a failure and — since nothing
    // was saved — drop the user back on the Join screen at the next cold start.
    service.joinScoreboard.mockResolvedValue(board);
    writeSession.mockRejectedValue(new Error("storage is full"));
    const store = makeStore();

    const action = await store.dispatch(joinScoreboard("ab12cd"));

    expect(action.type).toBe("scoreboard/join/fulfilled");
    expect(state(store).current).toEqual(board);
    expect(state(store).status).toBe("connected");
  });

  it("resets the store on leave even when clearing the session fails", async () => {
    service.leaveScoreboard.mockResolvedValue(undefined);
    clearSession.mockRejectedValue(new Error("storage is full"));
    const store = makeStore();
    store.dispatch(applyBoard(board));

    await store.dispatch(leaveScoreboard());

    expect(state(store).current).toBeNull();
    expect(state(store).status).toBe("idle");
  });

  it("resets the store on delete even when clearing the session fails", async () => {
    service.deleteCurrentScoreboard.mockResolvedValue(undefined);
    clearSession.mockRejectedValue(new Error("storage is full"));
    const store = makeStore();
    store.dispatch(applyBoard(board));

    await store.dispatch(deleteCurrentScoreboard());

    expect(state(store).current).toBeNull();
  });
});

describe("leaveScoreboard", () => {
  it("reports a failed leave with a described message and keeps the board", async () => {
    // The board is still open, so the store keeps it: only the failure is owed.
    // Resetting here would leave a user who is still in the room with no board
    // on screen, and a raw storage message would never describe the gateway.
    service.leaveScoreboard.mockRejectedValue(new ApiClientError("Bad gateway", 502));
    const store = makeStore();
    store.dispatch(applyBoard(board));

    const action = await store.dispatch(leaveScoreboard());

    expect(action.type).toBe("scoreboard/leave/rejected");
    expect(action.payload).toBe("Bad gateway");
    expect(state(store).current).toEqual(board);
  });
});

describe("joinScoreboard codes", () => {
  it("trims and uppercases before the length check", async () => {
    service.joinScoreboard.mockResolvedValue(board);
    const store = makeStore();

    const padded = await store.dispatch(joinScoreboard("  ab12cd  "));
    expect(padded.type).toBe("scoreboard/join/fulfilled");
    expect(service.joinScoreboard).toHaveBeenCalledWith("AB12CD");

    // Six units before trimming, four after: padding does not make a short
    // code joinable, it just makes it look like one.
    const tooShort = await store.dispatch(joinScoreboard("  ab12  "));
    expect(tooShort.type).toBe("scoreboard/join/rejected");
    expect(tooShort.payload).toBe("A scoreboard code is 6 characters");
  });
});
