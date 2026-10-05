/// <reference types="jest" />
import AsyncStorage from "@react-native-async-storage/async-storage";
import { configureStore } from "@reduxjs/toolkit";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import type { ReactNode } from "react";
import { Provider } from "react-redux";
import { tabs } from "../constants/data";
import type { Scoreboard } from "../src/features/scoreTracking/domain/Scoreboard";
import {
  scoreboardService,
  type ScoreboardService,
  type ServiceEvent,
} from "../src/features/scoreTracking/domain/ScoreboardService";
import {
  readSavedSession,
  writeSavedSession,
} from "../src/features/scoreTracking/domain/ScoreboardSession";
import reducer, { applyBoard } from "../src/features/scoreTracking/scoreTrackingSlice";
import { useScoreboardSync } from "../src/features/scoreTracking/useScoreboardSync";

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

jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));

const service = scoreboardService as jest.Mocked<ScoreboardService>;
const replace = router.replace as jest.MockedFunction<typeof router.replace>;

const board: Scoreboard = {
  id: "board-1",
  gameName: "Catan",
  code: "AB12CD",
  players: [{ id: 1, name: "Amir", score: 3 }],
  updateTime: "2026-09-25T10:00:00.000Z",
};

const makeStore = () => configureStore({ reducer: { scoreboard: reducer } });
type TestStore = ReturnType<typeof makeStore>;

const joinRoute = () => {
  const joinTab = tabs.find((tab) => tab.title === "Join");
  if (!joinTab) throw new Error("constants/data.ts has no Join tab");
  return `/(main)/${joinTab.name}`;
};

let emit: ((event: ServiceEvent) => void) | null = null;
let unsubscribed = false;

const mount = async (store: TestStore = makeStore()) => {
  const rendered = await renderHook(() => useScoreboardSync(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    ),
  });
  return { store, unmount: rendered.unmount };
};

const deliver = async (event: ServiceEvent) => {
  if (!emit) throw new Error("the hook never subscribed to the service");
  await act(async () => {
    emit?.(event);
  });
};

beforeEach(async () => {
  jest.clearAllMocks();
  emit = null;
  unsubscribed = false;
  await AsyncStorage.clear();
  service.subscribe.mockImplementation((listener) => {
    emit = listener;
    return () => {
      unsubscribed = true;
      emit = null;
    };
  });
  service.joinScoreboard.mockResolvedValue(board);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("useScoreboardSync: the board's owner deleted it", () => {
  it("lands on the Join tab, which is where a user with no board can act", async () => {
    const { store } = await mount();
    store.dispatch(applyBoard(board));

    await deliver({ type: "disconnected" });

    expect(replace).toHaveBeenCalledWith(joinRoute());
    expect(store.getState().scoreboard.current).toBeNull();
    expect(store.getState().scoreboard.status).toBe("idle");
  });

  it("forgets the session pointer that would rejoin the deleted board", async () => {
    await writeSavedSession({ id: board.id, code: board.code });
    expect(await readSavedSession()).toEqual({ id: "board-1", code: "AB12CD" });

    await mount();
    await deliver({ type: "disconnected" });

    await waitFor(async () => expect(await readSavedSession()).toBeNull());
  });

  it("still leaves the board when clearing storage fails", async () => {
    jest.spyOn(AsyncStorage, "removeItem").mockRejectedValue(new Error("storage is full"));
    const { store } = await mount();
    store.dispatch(applyBoard(board));

    await deliver({ type: "disconnected" });

    expect(store.getState().scoreboard.current).toBeNull();
    expect(replace).toHaveBeenCalledWith(joinRoute());
  });
});

describe("useScoreboardSync: the other gateway events", () => {
  it("applies a board the service broadcast, and stays where it is", async () => {
    const { store } = await mount();

    await deliver({ type: "board", board });

    expect(store.getState().scoreboard.current).toEqual(board);
    expect(replace).not.toHaveBeenCalled();
  });

  it("carries a status and an error into the store", async () => {
    const { store } = await mount();

    await deliver({ type: "status", status: "reconnecting" });
    expect(store.getState().scoreboard.status).toBe("reconnecting");

    await deliver({ type: "error", message: "Bad gateway" });
    expect(store.getState().scoreboard.error).toBe("Bad gateway");
  });

  it("unsubscribes on unmount, so a torn-down screen stops listening", async () => {
    const { store, unmount } = await mount();
    store.dispatch(applyBoard(board));

    await act(async () => {
      await unmount();
    });

    expect(unsubscribed).toBe(true);
    expect(emit).toBeNull();
    expect(store.getState().scoreboard.current).toEqual(board);
  });
});
