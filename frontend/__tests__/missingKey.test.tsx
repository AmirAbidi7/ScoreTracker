/// <reference types="jest" />
// Missing-key boot: without EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY _layout renders
// the tree with NO ClerkProvider. The real @clerk/expo hooks throw when there
// is no provider (createContextAndHook asserts context), so these mocks mirror
// that behavior: every Clerk hook throws, like a default checkout.
jest.mock("@clerk/expo", () => {
  const missing = () => {
    throw new Error("AuthClient not found");
  };
  return {
    useAuth: missing,
    useUser: missing,
    useSignIn: missing,
    useSignUp: missing,
    useSSO: missing,
    useClerk: missing,
  };
});

jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));

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

import { configureStore } from "@reduxjs/toolkit";
import { render, screen } from "@testing-library/react-native";
import { Provider } from "react-redux";
import SignInScreen from "../src/features/auth/pages/signIn";
import ScoreTrackingPage from "../src/features/scoreTracking/pages/scoreTracking";
import reducer, { applyBoard } from "../src/features/scoreTracking/scoreTrackingSlice";
import SyncGame from "../src/features/syncGame/syncGame";
import type { Scoreboard } from "../src/features/scoreTracking/domain/Scoreboard";

beforeEach(() => {
  process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY = "";
});

const board: Scoreboard = {
  id: "board-1",
  gameName: "Catan",
  code: "AB12CD",
  players: [{ id: 1, name: "Amir", score: 20 }],
  updateTime: "2026-09-25T10:00:00.000Z",
  ownerId: "user_owner",
};

describe("missing Clerk key: the app boots to signed-out view-only", () => {
  test("the board still renders with a sign-in prompt instead of crashing", async () => {
    const store = configureStore({ reducer: { scoreboard: reducer } });
    store.dispatch(applyBoard(board));
    await render(
      <Provider store={store}>
        <ScoreTrackingPage />
      </Provider>,
    );

    expect(screen.getByTestId("sign-in-prompt")).toBeTruthy();
    expect(screen.getByTestId("player-name-1")).toBeTruthy();
  });

  test("the join tab still renders instead of crashing", async () => {
    const store = configureStore({ reducer: { scoreboard: reducer } });
    await render(
      <Provider store={store}>
        <SyncGame />
      </Provider>,
    );

    expect(screen.getByTestId("join-button")).toBeTruthy();
    expect(screen.getByTestId("create-sign-in-prompt")).toBeTruthy();
  });

  test("the sign-in screen says auth is unavailable instead of crashing", async () => {
    await render(<SignInScreen />);

    expect(screen.getByTestId("auth-unavailable")).toBeTruthy();
    expect(screen.queryByTestId("auth-email-input")).toBeNull();
  });
});
