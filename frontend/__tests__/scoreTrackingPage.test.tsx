/// <reference types="jest" />
import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { Provider } from "react-redux";
import type { ScoreboardAck } from "../infrastructure/socket/scoreboardSocket";
import type { Scoreboard } from "../src/features/scoreTracking/domain/Scoreboard";
import {
  scoreboardService,
  type ScoreboardService,
} from "../src/features/scoreTracking/domain/ScoreboardService";
import ScoreTrackingPage from "../src/features/scoreTracking/pages/scoreTracking";
import reducer, {
  applyBoard,
  setError,
  setStatus,
} from "../src/features/scoreTracking/scoreTrackingSlice";

/**
 * Only the gateway is faked. Everything between the press and the store is the
 * real thing: the real thunk, the real slice, the real component. So a passing
 * assertion here is a claim about what the page actually does, not about a
 * recorded dispatch — and a `sendIntent` that quietly started writing scores
 * locally would fail these tests rather than pass them.
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

const service = scoreboardService as jest.Mocked<ScoreboardService>;

/**
 * Deliberately not in score order. Anything that ranked by array position
 * instead of by score would number these players 1, 2, 3 and pass; the ranks
 * here are 2, 1, 3.
 */
const board: Scoreboard = {
  id: "board-1",
  gameName: "Catan",
  code: "AB12CD",
  players: [
    { id: 2, name: "Dolly", score: 10 },
    { id: 1, name: "Amir", score: 20 },
    { id: 3, name: "Sally", score: 8 },
  ],
  updateTime: "2026-09-25T10:00:00.000Z",
};

const makeStore = () => configureStore({ reducer: { scoreboard: reducer } });
type TestStore = ReturnType<typeof makeStore>;

/**
 * Seeded through the slice's own actions before the page mounts, so the page
 * sees a store that a real store could have produced — no hand-built state
 * object that no reducer could ever have left behind.
 */
const renderPage = async (
  seed: (store: TestStore) => void = () => {},
): Promise<TestStore> => {
  const store = makeStore();
  seed(store);
  await render(
    <Provider store={store}>
      <ScoreTrackingPage />
    </Provider>,
  );
  return store;
};

/** An ack carrying the server's own board, with every score settled at `score`. */
const scored = (score: number): ScoreboardAck => ({
  ok: true,
  scoreboard: {
    ...board,
    players: board.players.map((player) => ({ ...player, score })),
    updateTime: "2026-09-25T10:05:00.000Z",
  },
});

/** The buttons the page handed to the platform `Alert`. */
const alertButtons = (alert: jest.SpiedFunction<typeof Alert.alert>, index = 0) => {
  const buttons = alert.mock.calls[index][2] ?? [];
  return {
    cancel: buttons.find((button) => button.text === "Cancel"),
    confirm: buttons.find((button) => button.text === "Delete"),
  };
};

/**
 * Presses one of the alert's own buttons, exactly as the platform would: the
 * button object the page passed in, not a call to the handler the test extracted
 * from the component. Cancelling has no `onPress` at all, which is the point.
 */
const pressAlertButton = async (
  button: { onPress?: () => void } | undefined,
  label: string,
): Promise<void> => {
  if (!button) throw new Error(`the alert had no "${label}" button`);
  await act(async () => {
    button.onPress?.();
  });
};

beforeEach(() => {
  jest.resetAllMocks();
  service.sendIntent.mockResolvedValue({ ok: false, code: 400, message: "No such player" });
  service.leaveScoreboard.mockResolvedValue(undefined);
  service.deleteCurrentScoreboard.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("no game joined", () => {
  it("shows the empty state instead of a board", async () => {
    await renderPage();

    expect(screen.getByTestId("empty-state")).toBeOnTheScreen();
    expect(screen.getByText("No game yet")).toBeOnTheScreen();
    expect(screen.queryByTestId("game-header")).toBeNull();
    expect(screen.queryByTestId("add-player-fab")).toBeNull();
  });

  it("says what went wrong when the store carries an error", async () => {
    await renderPage((store) => store.dispatch(setError("Can't reach the server")));

    expect(screen.getByText("Can't reach the server")).toBeOnTheScreen();
    // The reason for the error is worth more than the standing hint, and it is
    // the only thing the user can act on without leaving the tab.
    expect(screen.queryByText("Enter a code on the Join tab, or start a new game.")).toBeNull();
  });

  /**
   * The button says "Dismiss" because that is all it can do. With no board there
   * is no code to rejoin and no saved session to retry from, so a label
   * promising a second attempt is a label that lies.
   */
  it("offers a dismiss, not a retry it cannot honour", async () => {
    await renderPage();

    expect(screen.getByText("Dismiss")).toBeOnTheScreen();
    expect(screen.queryByText("Retry")).toBeNull();
  });

  it("clears the stale error when the user dismisses the empty state", async () => {
    const store = await renderPage((s) => s.dispatch(setError("Can't reach the server")));

    await fireEvent.press(screen.getByTestId("empty-state-dismiss"));

    expect(service.leaveScoreboard).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByText("Enter a code on the Join tab, or start a new game.")).toBeOnTheScreen(),
    );
    expect(store.getState().scoreboard.error).toBeNull();
  });
});

describe("the board on screen", () => {
  it("renders each player with the score the server sent", async () => {
    await renderPage((store) => store.dispatch(applyBoard(board)));

    expect(screen.getByText("Catan")).toBeOnTheScreen();
    expect(screen.getByText("AB12CD")).toBeOnTheScreen();
    expect(screen.getByTestId("player-name-1")).toHaveTextContent("Amir");
    expect(screen.getByTestId("player-score-1")).toHaveTextContent("20");
    expect(screen.getByTestId("player-score-2")).toHaveTextContent("10");
    expect(screen.getByTestId("player-score-3")).toHaveTextContent("8");
  });

  it("numbers players by score rather than by the order they arrived in", async () => {
    await renderPage((store) => store.dispatch(applyBoard(board)));

    // 20, 10, 8 for ids 1, 2, 3 — while the board lists them 2, 1, 3.
    expect(screen.getByTestId("player-rank-1")).toHaveTextContent("1.");
    expect(screen.getByTestId("player-rank-2")).toHaveTextContent("2.");
    expect(screen.getByTestId("player-rank-3")).toHaveTextContent("3.");
  });

  it("asks for players when the board has none", async () => {
    await renderPage((store) =>
      store.dispatch(applyBoard({ ...board, players: [] })),
    );

    expect(screen.getByTestId("no-players")).toBeOnTheScreen();
    expect(screen.queryByTestId("player-name-1")).toBeNull();
  });
});

describe("scoring", () => {
  it("sends the entered amount and leaves the score where the server left it", async () => {
    // Never resolves: this is the window in which the old reducers used to have
    // moved the score locally.
    service.sendIntent.mockReturnValue(new Promise<ScoreboardAck>(() => {}));
    const store = await renderPage((s) => s.dispatch(applyBoard(board)));

    await fireEvent.changeText(screen.getByTestId("amount-1"), "3");
    await fireEvent.press(screen.getByTestId("add-score-1"));

    expect(service.sendIntent).toHaveBeenCalledTimes(1);
    expect(service.sendIntent).toHaveBeenCalledWith({
      type: "addScore",
      playerId: 1,
      amount: 3,
    });
    expect(screen.getByTestId("player-score-1")).toHaveTextContent("20");
    // The whole board, not just the row on screen: an intent that had quietly
    // added 3 here would leave the rendered number stale but the state moved.
    expect(store.getState().scoreboard.current).toEqual(board);
  });

  it("negates the amount for the minus button, and sends only that", async () => {
    service.sendIntent.mockReturnValue(new Promise<ScoreboardAck>(() => {}));
    await renderPage((store) => store.dispatch(applyBoard(board)));

    await fireEvent.changeText(screen.getByTestId("amount-2"), "4");
    await fireEvent.press(screen.getByTestId("subtract-score-2"));

    // `toHaveBeenCalledTimes` first: a `+4` alongside the `-4` would satisfy a
    // bare `toHaveBeenCalledWith`, and the two together would double the score.
    expect(service.sendIntent).toHaveBeenCalledTimes(1);
    expect(service.sendIntent).toHaveBeenCalledWith({
      type: "addScore",
      playerId: 2,
      amount: -4,
    });
  });

  it("sends one intent per press, never one per direction", async () => {
    service.sendIntent.mockReturnValue(new Promise<ScoreboardAck>(() => {}));
    const store = await renderPage((s) => s.dispatch(applyBoard(board)));

    await fireEvent.press(screen.getByTestId("add-score-1"));
    await fireEvent.press(screen.getByTestId("subtract-score-1"));

    expect(service.sendIntent).toHaveBeenCalledTimes(2);
    expect(store.getState().scoreboard.pendingIntents).toBe(2);
  });

  it("disables the buttons for an amount that is not a usable number", async () => {
    service.sendIntent.mockReturnValue(new Promise<ScoreboardAck>(() => {}));
    const store = await renderPage((s) => s.dispatch(applyBoard(board)));

    expect(screen.getByTestId("add-score-1")).toBeEnabled();

    // The server would accept 0 and apply it as a no-op write: a request, a
    // broadcast and a "Saving 1 change…" flash for a score that did not change.
    // `keyboardType="numeric"` is a hint, so all of these are reachable.
    for (const amount of ["", "   ", "abc", "0", "1,000"]) {
      await fireEvent.changeText(screen.getByTestId("amount-1"), amount);
      await fireEvent.press(screen.getByTestId("add-score-1"));
      await fireEvent.press(screen.getByTestId("subtract-score-1"));

      // Not merely inert: visibly inert, so a dead press is not mistaken for a
      // dropped tap. The class is the only place the dimming is observable —
      // NativeWind resolves it to a style no query can see.
      expect(screen.getByTestId("add-score-1")).toBeDisabled();
      expect(screen.getByTestId("subtract-score-1")).toBeDisabled();
      expect(screen.getByTestId("add-score-1").props.className).toContain("opacity-50");
    }

    expect(service.sendIntent).not.toHaveBeenCalled();
    expect(store.getState().scoreboard.pendingIntents).toBe(0);
    expect(screen.queryByTestId("pending-banner")).toBeNull();
  });

  it("enables the buttons again once the amount is usable", async () => {
    service.sendIntent.mockReturnValue(new Promise<ScoreboardAck>(() => {}));
    await renderPage((store) => store.dispatch(applyBoard(board)));

    await fireEvent.changeText(screen.getByTestId("amount-1"), "abc");
    expect(screen.getByTestId("add-score-1")).toBeDisabled();

    await fireEvent.changeText(screen.getByTestId("amount-1"), "2");
    expect(screen.getByTestId("add-score-1")).toBeEnabled();
    expect(screen.getByTestId("subtract-score-1")).toBeEnabled();
    expect(screen.getByTestId("add-score-1").props.className).not.toContain("opacity-50");
  });

  it("shows the pending banner while the server decides, and the server's score after", async () => {
    let release!: (ack: ScoreboardAck) => void;
    service.sendIntent.mockReturnValue(
      new Promise<ScoreboardAck>((resolve) => {
        release = resolve;
      }),
    );
    const store = await renderPage((s) => s.dispatch(applyBoard(board)));

    expect(screen.queryByTestId("pending-banner")).toBeNull();

    await fireEvent.press(screen.getByTestId("add-score-1"));

    await screen.findByTestId("pending-banner");
    expect(screen.getByTestId("pending-banner")).toHaveTextContent("Saving 1 change...");
    expect(store.getState().scoreboard.pendingIntents).toBe(1);

    await act(async () => {
      release(scored(23));
    });

    await waitFor(() => expect(screen.queryByTestId("pending-banner")).toBeNull());
    expect(store.getState().scoreboard.pendingIntents).toBe(0);
    expect(screen.getByTestId("player-score-1")).toHaveTextContent("23");
  });

  it("counts the changes in flight, in the plural when there is more than one", async () => {
    service.sendIntent.mockReturnValue(new Promise<ScoreboardAck>(() => {}));
    await renderPage((store) => store.dispatch(applyBoard(board)));

    await fireEvent.press(screen.getByTestId("add-score-1"));
    await fireEvent.press(screen.getByTestId("add-score-2"));

    expect(await screen.findByTestId("pending-banner")).toHaveTextContent(
      "Saving 2 changes...",
    );
  });

  it("sends a removePlayer intent from a long press on the card's trash control", async () => {
    service.sendIntent.mockReturnValue(new Promise<ScoreboardAck>(() => {}));
    const store = await renderPage((s) => s.dispatch(applyBoard(board)));

    const trash = screen.getByTestId("remove-player-3");

    // A plain tap removes nobody: dropping a player costs them their place in
    // the game for everyone, so it takes the same deliberate gesture as deleting
    // the game does.
    await fireEvent.press(trash);
    expect(service.sendIntent).not.toHaveBeenCalled();

    await fireEvent(trash, "longPress");

    expect(service.sendIntent).toHaveBeenCalledTimes(1);
    expect(service.sendIntent).toHaveBeenCalledWith({
      type: "removePlayer",
      playerId: 3,
    });
    // The hint is what makes a hidden gesture discoverable to a screen reader.
    expect(trash.props.accessibilityHint).toContain("Sally");
    expect(store.getState().scoreboard.current).toEqual(board);
  });
});

describe("adding a player", () => {
  it("sends the trimmed name and closes the modal", async () => {
    service.sendIntent.mockReturnValue(new Promise<ScoreboardAck>(() => {}));
    await renderPage((store) => store.dispatch(applyBoard(board)));

    await fireEvent.press(screen.getByTestId("add-player-fab"));
    await fireEvent.changeText(screen.getByTestId("player-name-input"), "  Bryan  ");
    await fireEvent.press(screen.getByTestId("add-player-button"));

    expect(service.sendIntent).toHaveBeenCalledWith({ type: "addPlayer", name: "Bryan" });
    // The modal is closed, and the name is gone: the next one starts empty.
    expect(screen.queryByTestId("player-name-input")).toBeNull();
  });

  it("sends nothing for a name that is only whitespace", async () => {
    service.sendIntent.mockReturnValue(new Promise<ScoreboardAck>(() => {}));
    await renderPage((store) => store.dispatch(applyBoard(board)));

    await fireEvent.press(screen.getByTestId("add-player-fab"));
    await fireEvent.changeText(screen.getByTestId("player-name-input"), "   ");
    await fireEvent.press(screen.getByTestId("add-player-button"));

    expect(service.sendIntent).not.toHaveBeenCalled();
  });

  it("can be dismissed without sending anything", async () => {
    service.sendIntent.mockReturnValue(new Promise<ScoreboardAck>(() => {}));
    await renderPage((store) => store.dispatch(applyBoard(board)));

    await fireEvent.press(screen.getByTestId("add-player-fab"));
    await fireEvent.press(screen.getByTestId("cancel-add-player"));

    expect(screen.queryByTestId("player-name-input")).toBeNull();
    expect(service.sendIntent).not.toHaveBeenCalled();
  });
});

describe("connection and error banners", () => {
  it.each([
    ["connecting", "Reconnecting..."],
    ["reconnecting", "Reconnecting..."],
    ["offline", "Offline..."],
  ] as const)("warns while the connection is %s", async (status, expected) => {
    await renderPage((store) => {
      store.dispatch(applyBoard(board));
      store.dispatch(setStatus(status));
    });

    expect(screen.getByTestId("connection-banner")).toHaveTextContent(expected);
  });

  it("says nothing about the connection while it is up", async () => {
    await renderPage((store) => {
      store.dispatch(applyBoard(board));
      store.dispatch(setStatus("connected"));
    });

    expect(screen.queryByTestId("connection-banner")).toBeNull();
    expect(screen.queryByTestId("scoreboard-error")).toBeNull();
  });

  it("surfaces a failure the service reported", async () => {
    await renderPage((store) => {
      store.dispatch(applyBoard(board));
      store.dispatch(setStatus("connected"));
      store.dispatch(setError("No such player"));
    });

    expect(screen.getByTestId("scoreboard-error")).toHaveTextContent("No such player");
  });

  /**
   * The end of the silent-refusal path: the server turns the change down, the
   * pending banner comes and goes, and the user is told why the score did not
   * move. The connection is up throughout, so the connection banner cannot be
   * what covers for this.
   */
  it("says why a score the server refused did not change", async () => {
    service.sendIntent.mockResolvedValue({
      ok: false,
      code: 404,
      message: "No such player",
    });
    const store = await renderPage((s) => {
      s.dispatch(applyBoard(board));
      s.dispatch(setStatus("connected"));
    });

    await fireEvent.press(screen.getByTestId("add-score-1"));

    await screen.findByTestId("scoreboard-error");
    expect(screen.getByTestId("scoreboard-error")).toHaveTextContent("No such player");
    // The refusal is reported and nothing else changes: no banner left spinning,
    // and the score exactly where the server left it.
    expect(screen.queryByTestId("pending-banner")).toBeNull();
    expect(store.getState().scoreboard.current).toEqual(board);
  });

  /**
   * A failure that has stopped being true has to stop being shown, or it becomes
   * a line the user cannot dismiss. Nothing between two intents clears it — the
   * gateway reports a status only on connect, reconnect and disconnect — so the
   * next change going through is the only thing that can.
   */
  it("takes the refusal away once a later change goes through", async () => {
    service.sendIntent.mockResolvedValueOnce({
      ok: false,
      code: 404,
      message: "No such player",
    });
    const store = await renderPage((s) => {
      s.dispatch(applyBoard(board));
      s.dispatch(setStatus("connected"));
    });

    await fireEvent.press(screen.getByTestId("add-score-1"));
    await screen.findByTestId("scoreboard-error");

    service.sendIntent.mockResolvedValueOnce(scored(23));
    await fireEvent.press(screen.getByTestId("add-score-1"));

    await waitFor(() => expect(screen.queryByTestId("scoreboard-error")).toBeNull());
    expect(screen.getByTestId("player-score-1")).toHaveTextContent("23");
    expect(store.getState().scoreboard.error).toBeNull();
  });
});

describe("deleting the game", () => {
  let alert: jest.SpiedFunction<typeof Alert.alert>;

  beforeEach(() => {
    alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  it("reaches the confirmation from a long press on the header, naming the game", async () => {
    await renderPage((store) => store.dispatch(applyBoard(board)));

    expect(alert).not.toHaveBeenCalled();

    await fireEvent(screen.getByTestId("game-header"), "longPress");

    expect(alert).toHaveBeenCalledTimes(1);
    const [title, message] = alert.mock.calls[0];
    expect(title).toBe("Delete game?");
    expect(message).toContain("Catan");
    // Nothing has been sent yet: the alert is the gate, not a formality.
    expect(service.deleteCurrentScoreboard).not.toHaveBeenCalled();
  });

  it("does not delete when the confirmation is cancelled", async () => {
    const store = await renderPage((s) => s.dispatch(applyBoard(board)));
    await fireEvent(screen.getByTestId("game-header"), "longPress");

    const { cancel, confirm } = alertButtons(alert);
    // The style is what the platform uses to decide whether this button is the
    // safe way out, so a swap with the destructive one has to fail here and not
    // merely in a reviewer's reading.
    expect(cancel?.style).toBe("cancel");
    expect(confirm?.style).toBe("destructive");
    // Cancel is not a quieter delete: it has no handler at all.
    expect(cancel?.onPress).toBeUndefined();

    await pressAlertButton(cancel, "Cancel");

    expect(service.deleteCurrentScoreboard).not.toHaveBeenCalled();
    expect(store.getState().scoreboard.current).toEqual(board);
    expect(screen.queryByTestId("empty-state")).toBeNull();
  });

  it("deletes the board only once the destructive button is confirmed", async () => {
    await renderPage((store) => store.dispatch(applyBoard(board)));
    await fireEvent(screen.getByTestId("game-header"), "longPress");

    const { confirm } = alertButtons(alert);
    expect(confirm?.style).toBe("destructive");
    await pressAlertButton(confirm, "Delete");

    expect(service.deleteCurrentScoreboard).toHaveBeenCalledTimes(1);
    // The thunk cleared the session, so the page falls back to the empty state.
    await screen.findByTestId("empty-state");
  });

  it("keeps the board on screen when the delete fails, and says why", async () => {
    // A failed delete is the store's to report as well as to keep: the board
    // still exists, so the room and the tracked code must survive, and the user
    // agreed to something irreversible and is owed a reason for it not happening.
    service.deleteCurrentScoreboard.mockRejectedValue(new Error("Bad gateway"));
    const store = await renderPage((s) => s.dispatch(applyBoard(board)));
    await fireEvent(screen.getByTestId("game-header"), "longPress");

    await pressAlertButton(alertButtons(alert).confirm, "Delete");

    // The banner is the page rendering `error`; no page change was needed for
    // the slice's new rejection case to become visible.
    await waitFor(() =>
      expect(screen.getByTestId("scoreboard-error")).toHaveTextContent("Bad gateway"),
    );
    expect(store.getState().scoreboard.current).toEqual(board);
    expect(screen.queryByTestId("empty-state")).toBeNull();
  });
});
