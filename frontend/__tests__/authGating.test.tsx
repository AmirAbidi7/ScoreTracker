/// <reference types="jest" />
jest.mock("@clerk/expo");
jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
import { configureStore } from "@reduxjs/toolkit";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { Alert } from "react-native";
import { Provider } from "react-redux";
import type { Scoreboard } from "../src/features/scoreTracking/domain/Scoreboard";
import type { ScoreboardService } from "../src/features/scoreTracking/domain/ScoreboardService";
import { scoreboardService } from "../src/features/scoreTracking/domain/ScoreboardService";
import ScoreTrackingPage, { AddPlayerModal } from "../src/features/scoreTracking/pages/scoreTracking";
import reducer, { applyBoard } from "../src/features/scoreTracking/scoreTrackingSlice";

jest.mock("../src/features/scoreTracking/domain/ScoreboardService", () => ({
  scoreboardService: {
    joinScoreboard: jest.fn(),
    createScoreboard: jest.fn(),
    listScoreboards: jest.fn(),
    leaveScoreboard: jest.fn(),
    deleteCurrentScoreboard: jest.fn(),
    claimScoreboard: jest.fn(),
    sendIntent: jest.fn(),
    subscribe: jest.fn(() => () => {}),
  },
}));

const clerk = jest.requireMock("@clerk/expo") as {
  __clerkState: { isSignedIn: boolean; userId: string | null };
  __clerkReset: () => void;
};

const service = scoreboardService as jest.Mocked<ScoreboardService>;

const board = (ownerId: string | null): Scoreboard => ({
  id: "board-1",
  gameName: "Catan",
  code: "AB12CD",
  players: [{ id: 1, name: "Amir", score: 20 }],
  updateTime: "2026-09-25T10:00:00.000Z",
  ownerId,
});

const renderBoard = async (ownerId: string | null) => {
  const store = configureStore({ reducer: { scoreboard: reducer } });
  store.dispatch(applyBoard(board(ownerId)));
  await render(
    <Provider store={store}>
      <ScoreTrackingPage />
    </Provider>,
  );
  return store;
};

beforeEach(() => {
  clerk.__clerkReset();
  jest.spyOn(Alert, "alert").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("auth gating: signed-out viewers watch live", () => {
  test("intent controls are disabled and a sign-in prompt is offered", async () => {
    await renderBoard("user_owner");

    expect(screen.getByTestId("sign-in-prompt")).toBeTruthy();
    expect(screen.getByTestId("add-score-1").props.accessibilityState?.disabled).toBe(true);
    expect(screen.queryByTestId("claim-board")).toBeNull();
  });

  test("delete stays hidden for signed-out viewers", async () => {
    await renderBoard("user_owner");

    fireEvent(screen.getByTestId("game-header"), "longPress");
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});

describe("auth gating: signed-in on an ownerless board", () => {
  test("a claim button appears and claiming dispatches", async () => {
    clerk.__clerkState.isSignedIn = true;
    clerk.__clerkState.userId = "user_abc";
    await renderBoard(null);

    await fireEvent.press(screen.getByTestId("claim-board"));
    expect(service.claimScoreboard).toHaveBeenCalled();
    expect(screen.queryByTestId("sign-in-prompt")).toBeNull();
  });

  test("intent controls stay disabled until the board is claimed", async () => {
    clerk.__clerkState.isSignedIn = true;
    clerk.__clerkState.userId = "user_abc";
    await renderBoard(null);

    expect(screen.getByTestId("add-score-1").props.accessibilityState?.disabled).toBe(true);
  });
});

describe("auth gating: the add-player form", () => {
  test("a read-only viewer cannot submit from the form", async () => {
    const store = configureStore({ reducer: { scoreboard: reducer } });
    await render(
      <Provider store={store}>
        <AddPlayerModal active onClose={() => {}} readOnly />
      </Provider>,
    );

    await fireEvent.changeText(screen.getByTestId("player-name-input"), "Bryan");
    await fireEvent.press(screen.getByTestId("add-player-button"));

    expect(service.sendIntent).not.toHaveBeenCalled();
  });

  test("the add-player button stays disabled for viewers who cannot edit", async () => {
    await renderBoard("user_owner");

    expect(screen.getByTestId("add-player-fab").props.accessibilityState?.disabled).toBe(true);
  });
});

describe("auth gating: joiners and owners", () => {
  test("a signed-in joiner edits but cannot delete", async () => {
    clerk.__clerkState.isSignedIn = true;
    clerk.__clerkState.userId = "user_joiner";
    await renderBoard("user_owner");

    expect(screen.getByTestId("add-score-1").props.accessibilityState?.disabled).not.toBe(true);
    expect(screen.queryByTestId("claim-board")).toBeNull();
    fireEvent(screen.getByTestId("game-header"), "longPress");
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  test("the owner deletes via the header", async () => {
    clerk.__clerkState.isSignedIn = true;
    clerk.__clerkState.userId = "user_owner";
    await renderBoard("user_owner");

    fireEvent(screen.getByTestId("game-header"), "longPress");
    expect(Alert.alert).toHaveBeenCalled();
  });
});
