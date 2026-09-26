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

/**
 * Only the gateway is faked, and it is the same gateway the other five suites
 * fake: the real thunk, the real slice and the real component are all in the
 * loop. So every assertion below is a claim about what this page does — about
 * the message a user would read, about where they would be sent — rather than a
 * recording of which functions the component happened to call.
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

jest.mock("expo-router", () => ({ router: { replace: jest.fn() } }));

const service = scoreboardService as jest.Mocked<ScoreboardService>;
const replace = router.replace as jest.MockedFunction<typeof router.replace>;

/** One player, so "1 player" and not "1 players" is a claim the tests can make. */
const catan: Scoreboard = {
  id: "board-1",
  gameName: "Catan",
  code: "AB12CD",
  players: [{ id: 1, name: "Amir", score: 0 }],
  updateTime: "2026-09-25T10:00:00.000Z",
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
};

const makeStore = () => configureStore({ reducer: { scoreboard: reducer } });
type TestStore = ReturnType<typeof makeStore>;

/**
 * Seeded through the slice's own action before the page mounts, so the page sees
 * a store a real one could have produced — no hand-built state that no reducer
 * could ever have left behind.
 */
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

/**
 * The Scoreboard tab, derived rather than written out.
 *
 * The page navigates to a string, and the generated route types catch a wrong
 * segment — but only against the `.expo/types/router.d.ts` as it was last
 * generated, so a tab renamed in `constants/data.ts` typechecks fine until
 * someone runs the CLI again. `constants/data.ts` is where the app decides what
 * the Scoreboard tab is called, and that tab lives under the `(main)` layout, so
 * deriving the route from it asserts a relationship between the two files: a
 * rename fails here rather than sending the user nowhere.
 */
const scoreboardRoute = (): string => {
  const tab = tabs.find((candidate) => candidate.title === "Scoreboard");
  if (!tab) throw new Error("constants/data.ts has no Scoreboard tab");
  return `/(main)/${tab.name}`;
};

/** A promise held open, to keep the page in its loading or in-flight state. */
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const settleWith = async (boards: Scoreboard[]): Promise<void> => {
  await screen.findByTestId(`board-${boards[0].id}`);
};

beforeEach(() => {
  jest.resetAllMocks();
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
    // A list that renders itself empty before it has been told anything is the
    // same picture as a server that has no games.
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

    // The list's own failure is nowhere in the store's `error` field — that one
    // belongs to the board that is open, and only a refused intent or a gateway
    // event writes it. So a page that read the reason from there would have had
    // nothing to show, which is what this asserts.
    expect(store.getState().scoreboard.error).toBeNull();
  });

  it("never looks like a list that came back empty", async () => {
    service.listScoreboards.mockRejectedValue(new ApiClientError("Bad gateway", 502));

    await renderPage();

    await waitFor(() => expect(screen.getByTestId("boards-error")).toBeOnTheScreen());
    // "The load failed" and "there are no games" are different facts, and a
    // user who cannot tell them apart will conclude they have no games.
    expect(screen.queryByTestId("boards-empty")).toBeNull();
    expect(screen.queryByText("No games yet. Create one from the Join tab.")).toBeNull();
  });

  it("can be tried again, and the retry brings the list in", async () => {
    service.listScoreboards.mockRejectedValueOnce(new ApiClientError("Bad gateway", 502));
    service.listScoreboards.mockResolvedValue([catan, chess]);
    await renderPage();
    await waitFor(() => expect(screen.getByTestId("boards-error")).toBeOnTheScreen());

    await fireEvent.press(screen.getByTestId("boards-retry"));

    expect(service.listScoreboards).toHaveBeenCalledTimes(2);
    await settleWith([catan]);
    expect(screen.queryByTestId("boards-error")).toBeNull();
  });
});

describe("the list itself", () => {
  it("says there is nothing to join when the server sends no games", async () => {
    service.listScoreboards.mockResolvedValue([]);

    await renderPage();

    expect(await screen.findByTestId("boards-empty")).toHaveTextContent(
      "No games yet. Create one from the Join tab.",
    );
    // A list that failed to load says so; one that loaded has nothing to say.
    expect(screen.queryByTestId("boards-error")).toBeNull();
    expect(screen.queryByTestId(`board-${catan.id}`)).toBeNull();
  });

  it("lists every game with its code and how many are playing", async () => {
    await renderPage();

    await settleWith([catan, chess]);
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

    await settleWith([catan, chess]);
    expect(screen.getByTestId(`board-open-${catan.id}`)).toBeOnTheScreen();
    expect(screen.queryByTestId(`board-open-${chess.id}`)).toBeNull();

    // NativeWind resolves class names to styles no query can see, so the border
    // the open board is given is only observable here.
    expect(screen.getByTestId(`board-${catan.id}`).props.className).toContain("border-primary");
    expect(screen.getByTestId(`board-${chess.id}`).props.className).toContain("border-secondary");
  });

  it("marks nothing when this device is in no board", async () => {
    await renderPage();

    await settleWith([catan, chess]);
    expect(screen.queryByTestId(`board-open-${catan.id}`)).toBeNull();
    expect(screen.queryByTestId(`board-open-${chess.id}`)).toBeNull();
  });
});

describe("joining a game from a row", () => {
  it("joins the game that was pressed, with that row's own code", async () => {
    await renderPage();

    await settleWith([catan, chess]);
    await fireEvent.press(screen.getByTestId(`board-${chess.id}`));

    expect(service.joinScoreboard).toHaveBeenCalledTimes(1);
    expect(service.joinScoreboard).toHaveBeenCalledWith(chess.code);
    expect(service.joinScoreboard).not.toHaveBeenCalledWith(catan.code);
  });

  it("goes to the board the server sent, and to the Scoreboard tab", async () => {
    const store = await renderPage();

    await settleWith([catan, chess]);
    await fireEvent.press(screen.getByTestId(`board-${chess.id}`));

    await waitFor(() => expect(replace).toHaveBeenCalledWith(scoreboardRoute()));
    expect(store.getState().scoreboard.current).toEqual(chess);
  });

  /**
   * The navigation is the last thing to happen, so a refused join cannot leave
   * the user on a scoreboard they are not in — with no banner there to say so.
   */
  it("stays on this tab and says why when the server refuses the join", async () => {
    service.joinScoreboard.mockRejectedValue(new ApiClientError("Nope", 404));
    const store = await renderPage();

    await settleWith([catan, chess]);
    await fireEvent.press(screen.getByTestId(`board-${catan.id}`));

    await waitFor(() =>
      expect(screen.getByTestId("join-error")).toHaveTextContent("No scoreboard with that code"),
    );
    expect(replace).not.toHaveBeenCalled();
    // Nothing to have joined: the store is still saying what the server said.
    expect(store.getState().scoreboard.current).toBeNull();
    // The list is still here to try something else from.
    expect(screen.getByTestId(`board-${chess.id}`)).toBeOnTheScreen();
  });

  it("takes the last refusal away when the next attempt starts", async () => {
    service.joinScoreboard.mockRejectedValue(new ApiClientError("Nope", 404));
    await renderPage();
    await settleWith([catan, chess]);

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
    await settleWith([catan, chess]);

    await fireEvent.press(screen.getByTestId(`board-${chess.id}`));
    expect(screen.getByTestId(`board-${chess.id}`)).toBeDisabled();
    expect(screen.getByTestId(`board-${catan.id}`)).toBeDisabled();

    await fireEvent.press(screen.getByTestId(`board-${catan.id}`));

    expect(service.joinScoreboard).toHaveBeenCalledTimes(1);

    await act(async () => {
      request.resolve(chess);
    });

    await waitFor(() => expect(replace).toHaveBeenCalledWith(scoreboardRoute()));
    // The rows come back, so a board left and rejoined is not a dead end.
    expect(screen.getByTestId(`board-${chess.id}`)).toBeEnabled();
  });
});
