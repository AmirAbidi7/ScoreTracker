/// <reference types="jest" />
import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { router } from "expo-router";
import { Provider } from "react-redux";
import { tabs } from "../constants/data";
import { ApiClientError } from "../infrastructure/api/client";
import LeaderboardPage from "../src/features/leaderboard/pages/leaderboard";
import type { Scoreboard } from "../src/features/scoreTracking/domain/Scoreboard";
import {
  scoreboardService,
  type ScoreboardService,
} from "../src/features/scoreTracking/domain/ScoreboardService";
import reducer, { applyBoard } from "../src/features/scoreTracking/scoreTrackingSlice";

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

jest.mock("expo-router", () => {
  const { useEffect: useReactEffect } = require("react");
  const focusEffects: Array<() => void> = [];
  return {
    router: { replace: jest.fn() },
    focusEffects,
    useFocusEffect: (effect: () => void) => {
      focusEffects.push(effect);
      useReactEffect(() => {
        effect();
      }, [effect]);
    },
  };
});

const { focusEffects } = jest.requireMock("expo-router") as {
  focusEffects: Array<() => void>;
};

const refocus = async (): Promise<void> => {
  const effect = focusEffects[focusEffects.length - 1];
  if (!effect) throw new Error("the page never registered a focus effect");
  await act(async () => {
    effect();
  });
};

const service = scoreboardService as jest.Mocked<ScoreboardService>;
const replace = router.replace as jest.MockedFunction<typeof router.replace>;

const catan: Scoreboard = {
  id: "board-1",
  gameName: "Catan",
  code: "AB12CD",
  players: [{ id: 1, name: "Amir", score: 0 }],
  updateTime: "2026-09-25T10:00:00.000Z",
  ownerId: "user_owner",
};

const chess: Scoreboard = {
  id: "board-2",
  gameName: "Chess",
  code: "ZZ99ZZ",
  players: [
    { id: 1, name: "Amir", score: 0 },
    { id: 2, name: "Dolly", score: 0 },
  ],
  updateTime: "2026-09-25T11:00:00.000Z",
  ownerId: "user_owner",
};

const makeStore = () => configureStore({ reducer: { scoreboard: reducer } });
type TestStore = ReturnType<typeof makeStore>;

const renderPage = async (seed: (store: TestStore) => void = () => {}): Promise<TestStore> => {
  const store = makeStore();
  seed(store);
  await render(
    <Provider store={store}>
      <LeaderboardPage />
    </Provider>,
  );
  return store;
};

const scoreboardRoute = (): string => {
  const tab = tabs.find((candidate) => candidate.title === "Scoreboard");
  if (!tab) throw new Error("constants/data.ts has no Scoreboard tab");
  return `/(main)/${tab.name}`;
};

const waitForRows = async (): Promise<void> => {
  await screen.findByTestId(`board-${catan.id}`);
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const uno: Scoreboard = {
  id: "board-3",
  gameName: "Uno",
  code: "QQ77QQ",
  players: [{ id: 1, name: "Sally", score: 0 }],
  updateTime: "2026-09-25T12:00:00.000Z",
  ownerId: "user_owner",
};

beforeEach(() => {
  jest.resetAllMocks();
  focusEffects.length = 0;
  service.listScoreboards.mockResolvedValue([catan, chess]);
  service.joinScoreboard.mockResolvedValue(chess);
});

describe("loading the list", () => {
  it("asks the server once, and says so while the answer is in flight", async () => {
    const request = deferred<Scoreboard[]>();
    service.listScoreboards.mockReturnValue(request.promise);

    await renderPage();

    expect(service.listScoreboards).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("boards-loading")).toBeOnTheScreen();
    expect(screen.queryByTestId("boards-empty")).toBeNull();
    expect(screen.queryByTestId(`board-${catan.id}`)).toBeNull();

    await act(async () => {
      request.resolve([catan, chess]);
    });

    expect(await screen.findByTestId(`board-${catan.id}`)).toBeOnTheScreen();
    expect(screen.queryByTestId("boards-loading")).toBeNull();
  });
});

describe("a load that failed", () => {
  it("puts the reason the server gave on screen", async () => {
    service.listScoreboards.mockRejectedValue(new ApiClientError("Bad gateway", 502));
    const store = await renderPage();

    await waitFor(() => expect(screen.getByTestId("boards-error")).toBeOnTheScreen());
    expect(screen.getByTestId("boards-error")).toHaveTextContent("Bad gateway");

    expect(store.getState().scoreboard.error).toBeNull();
  });

  it("never looks like a list that came back empty", async () => {
    service.listScoreboards.mockRejectedValue(new ApiClientError("Bad gateway", 502));

    await renderPage();

    await waitFor(() => expect(screen.getByTestId("boards-error")).toBeOnTheScreen());
    expect(screen.queryByTestId("boards-empty")).toBeNull();
    expect(screen.queryByText("No games yet. Create one from the Join tab.")).toBeNull();
  });

  it("can be tried again, and the retry brings the list in", async () => {
    service.listScoreboards.mockRejectedValueOnce(new ApiClientError("Bad gateway", 502));
    service.listScoreboards.mockResolvedValue([catan, chess]);
    await renderPage();
    await waitFor(() => expect(screen.getByTestId("boards-error")).toBeOnTheScreen());

    await fireEvent.press(screen.getByTestId("boards-refresh"));

    expect(service.listScoreboards).toHaveBeenCalledTimes(2);
    await waitForRows();
    expect(screen.queryByTestId("boards-error")).toBeNull();
  });
});

describe("keeping the list current", () => {
  it("re-reads the list when the tab comes back into focus", async () => {
    await renderPage();
    await waitForRows();
    expect(service.listScoreboards).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId(`board-${uno.id}`)).toBeNull();

    service.listScoreboards.mockResolvedValue([catan, chess, uno]);
    await refocus();

    expect(service.listScoreboards).toHaveBeenCalledTimes(2);
    expect(await screen.findByTestId(`board-${uno.id}`)).toBeOnTheScreen();
  });

  it("can be refreshed by hand while the list is already on screen", async () => {
    await renderPage();
    await waitForRows();
    expect(screen.getByTestId("boards-refresh")).toBeOnTheScreen();

    service.listScoreboards.mockResolvedValue([catan, chess, uno]);
    await fireEvent.press(screen.getByTestId("boards-refresh"));

    expect(service.listScoreboards).toHaveBeenCalledTimes(2);
    expect(await screen.findByTestId(`board-${uno.id}`)).toBeOnTheScreen();
  });

  it("offers the refresh when there is nothing to list yet, too", async () => {
    service.listScoreboards.mockResolvedValue([]);

    await renderPage();

    expect(await screen.findByTestId("boards-empty")).toBeOnTheScreen();
    expect(screen.getByTestId("boards-refresh")).toBeOnTheScreen();
  });

  it("takes a stale refusal to join away when the list is re-read", async () => {
    service.joinScoreboard.mockRejectedValue(new ApiClientError("Nope", 404));
    await renderPage();
    await waitForRows();
    await fireEvent.press(screen.getByTestId(`board-${catan.id}`));
    await waitFor(() => expect(screen.getByTestId("join-error")).toBeOnTheScreen());

    await refocus();

    expect(screen.queryByTestId("join-error")).toBeNull();
  });
});

describe("the list itself", () => {
  it("says there is nothing to join when the server sends no games", async () => {
    service.listScoreboards.mockResolvedValue([]);

    await renderPage();

    expect(await screen.findByTestId("boards-empty")).toHaveTextContent(
      "No games yet. Create one from the Join tab.",
    );
    expect(screen.queryByTestId("boards-error")).toBeNull();
    expect(screen.queryByTestId(`board-${catan.id}`)).toBeNull();
  });

  it("lists every game with its code and how many are playing", async () => {
    await renderPage();

    await waitForRows();
    expect(screen.getByTestId(`board-name-${catan.id}`)).toHaveTextContent("Catan");
    expect(screen.getByTestId(`board-code-${catan.id}`)).toHaveTextContent("AB12CD");
    expect(screen.getByTestId(`board-name-${chess.id}`)).toHaveTextContent("Chess");
    expect(screen.getByTestId(`board-code-${chess.id}`)).toHaveTextContent("ZZ99ZZ");
    expect(screen.getByText("1 player")).toBeOnTheScreen();
    expect(screen.getByText("2 players")).toBeOnTheScreen();
    expect(screen.queryByTestId("boards-empty")).toBeNull();
  });

  it("marks the board this device is in, and only that one", async () => {
    await renderPage((store) => store.dispatch(applyBoard(catan)));

    await waitForRows();
    expect(screen.getByTestId(`board-open-${catan.id}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`board-open-${chess.id}`)).toBeNull();

    expect(screen.getByTestId(`board-${catan.id}`).props.className).toContain("border-primary");
    expect(screen.getByTestId(`board-${chess.id}`).props.className).toContain("border-secondary");

    expect(screen.getByTestId(`board-${catan.id}`)).toBeSelected();
    expect(screen.getByTestId(`board-${chess.id}`)).not.toBeSelected();
  });

  it("marks nothing when this device is in no board", async () => {
    await renderPage();

    await waitForRows();
    expect(screen.queryByTestId(`board-open-${catan.id}`)).toBeNull();
    expect(screen.queryByTestId(`board-open-${chess.id}`)).toBeNull();
    expect(screen.getByTestId(`board-${catan.id}`)).not.toBeSelected();
  });
});

describe("joining a game from a row", () => {
  it("joins the game that was pressed, with that row's own code", async () => {
    await renderPage();

    await waitForRows();
    await fireEvent.press(screen.getByTestId(`board-${chess.id}`));

    expect(service.joinScoreboard).toHaveBeenCalledTimes(1);
    expect(service.joinScoreboard).toHaveBeenCalledWith(chess.code);
    expect(service.joinScoreboard).not.toHaveBeenCalledWith(catan.code);
  });

  it("goes to the board the server sent, and to the Scoreboard tab", async () => {
    const store = await renderPage();

    await waitForRows();
    await fireEvent.press(screen.getByTestId(`board-${chess.id}`));

    await waitFor(() => expect(replace).toHaveBeenCalledWith(scoreboardRoute()));
    expect(store.getState().scoreboard.current).toEqual(chess);
  });

  it("stays on this tab and says why when the server refuses the join", async () => {
    service.joinScoreboard.mockRejectedValue(new ApiClientError("Nope", 404));
    const store = await renderPage();

    await waitForRows();
    await fireEvent.press(screen.getByTestId(`board-${catan.id}`));

    await waitFor(() =>
      expect(screen.getByTestId("join-error")).toHaveTextContent("No scoreboard with that code"),
    );
    expect(replace).not.toHaveBeenCalled();
    expect(store.getState().scoreboard.current).toBeNull();
    expect(screen.getByTestId(`board-${chess.id}`)).toBeOnTheScreen();
  });

  it("takes the last refusal away when the next attempt starts", async () => {
    service.joinScoreboard.mockRejectedValue(new ApiClientError("Nope", 404));
    await renderPage();
    await waitForRows();

    await fireEvent.press(screen.getByTestId(`board-${catan.id}`));
    await waitFor(() => expect(screen.getByTestId("join-error")).toBeOnTheScreen());

    service.joinScoreboard.mockResolvedValue(chess);
    await fireEvent.press(screen.getByTestId(`board-${chess.id}`));

    expect(screen.queryByTestId("join-error")).toBeNull();
  });

  it("holds every row while a join is in flight, so a second tap joins nothing twice", async () => {
    const request = deferred<Scoreboard>();
    service.joinScoreboard.mockReturnValue(request.promise);
    await renderPage();
    await waitForRows();

    await fireEvent.press(screen.getByTestId(`board-${chess.id}`));
    expect(screen.getByTestId(`board-${chess.id}`)).toBeDisabled();
    expect(screen.getByTestId(`board-${catan.id}`)).toBeDisabled();

    await fireEvent.press(screen.getByTestId(`board-${catan.id}`));

    expect(service.joinScoreboard).toHaveBeenCalledTimes(1);

    await act(async () => {
      request.resolve(chess);
    });

    await waitFor(() => expect(replace).toHaveBeenCalledWith(scoreboardRoute()));
    expect(screen.getByTestId(`board-${chess.id}`)).toBeEnabled();
  });
});
