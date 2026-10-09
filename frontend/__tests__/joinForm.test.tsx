/// <reference types="jest" />
jest.mock("@clerk/expo");
jest.mock("expo-router", () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
import { configureStore } from "@reduxjs/toolkit";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { Provider } from "react-redux";
import { ApiClient, ApiClientError } from "../infrastructure/api/client";
import type { Scoreboard } from "../src/features/scoreTracking/domain/Scoreboard";
import {
  scoreboardService,
  type ScoreboardService,
} from "../src/features/scoreTracking/domain/ScoreboardService";
import reducer, { applyBoard } from "../src/features/scoreTracking/scoreTrackingSlice";
import JoinPage from "../src/features/syncGame/syncGame";

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

const clerk = jest.requireMock("@clerk/expo") as {
  __clerkState: { isSignedIn: boolean; userId: string | null };
  __clerkReset: () => void;
};

beforeEach(() => {
  clerk.__clerkReset();
  clerk.__clerkState.isSignedIn = true;
  clerk.__clerkState.userId = "user_owner";
});

const board: Scoreboard = {
  id: "board-1",
  gameName: "Catan",
  code: "AB12CD",
  players: [{ id: 1, name: "Amir", score: 0 }],
  updateTime: "2026-09-25T10:00:00.000Z",
  ownerId: "user_owner",
};

const makeStore = () => configureStore({ reducer: { scoreboard: reducer } });
type TestStore = ReturnType<typeof makeStore>;

const renderPage = async (seed: (store: TestStore) => void = () => {}): Promise<TestStore> => {
  const store = makeStore();
  seed(store);
  await render(
    <Provider store={store}>
      <JoinPage />
    </Provider>,
  );
  return store;
};

const transportFailureFrom = async (cause: unknown): Promise<ApiClientError> => {
  const client = new ApiClient({
    baseUrl: "https://api.test",
    fetchImpl: () => Promise.reject(cause),
  });

  try {
    await client.joinScoreboard("AB12CD");
  } catch (error: unknown) {
    return error as ApiClientError;
  }
  throw new Error("expected the request to fail, but it resolved");
};

const unencodableFailureFor = (code: string): ApiClientError => {
  const fetchImpl = jest.fn(() => Promise.reject(new Error("must never be sent")));
  const client = new ApiClient({
    baseUrl: "https://api.test",
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });

  try {
    void client.joinScoreboard(code);
  } catch (error: unknown) {
    return error as ApiClientError;
  }
  throw new Error("expected the client to refuse the code, but it built a request");
};

const LONE_SURROGATE_CODE = "\uD800abcde";

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, resolve, reject };
};

const pressJoinWith = async (code: string) => {
  await fireEvent.changeText(screen.getByTestId("code-input"), code);
  await fireEvent.press(screen.getByTestId("join-button"));
};

const pressCreateWith = async (gameName: string) => {
  await fireEvent.changeText(screen.getByTestId("game-name-input"), gameName);
  await fireEvent.press(screen.getByTestId("create-button"));
};

beforeEach(() => {
  jest.resetAllMocks();
  service.joinScoreboard.mockResolvedValue(board);
  service.createScoreboard.mockResolvedValue(board);
});

describe("joining with a code", () => {
  it("trims and uppercases a pasted code before it is sent", async () => {
    await renderPage();

    await pressJoinWith("  ab12cd  ");

    expect(service.joinScoreboard).toHaveBeenCalledTimes(1);
    expect(service.joinScoreboard).toHaveBeenCalledWith("AB12CD");
  });

  it.each([["", "empty"], ["abc", "too short"], ["  ab  ", "padded short"], ["ab12cde", "too long"]])(
    "refuses a code that is %p (%s) without sending anything",
    async (code) => {
      await renderPage();

      await pressJoinWith(code);

      expect(service.joinScoreboard).not.toHaveBeenCalled();
      expect(screen.getByTestId("form-error")).toHaveTextContent(
        "A scoreboard code is 6 characters",
      );
    },
  );

  it("lands on the board the server sent, not the one that was typed", async () => {
    const store = await renderPage();

    await pressJoinWith("  ab12cd  ");

    await screen.findByTestId("current-board");
    expect(screen.getByText("Catan")).toBeOnTheScreen();
    expect(screen.getByTestId("current-code")).toHaveTextContent("AB12CD");
    expect(store.getState().scoreboard.current).toEqual(board);
    expect(screen.queryByTestId("code-input")).toBeNull();
  });

  it("says the code was not found when the server turns it down", async () => {
    service.joinScoreboard.mockRejectedValue(new ApiClientError("Scoreboard not found", 404));
    const store = await renderPage();

    await pressJoinWith("ZZZZZZ");

    await waitFor(() =>
      expect(screen.getByTestId("form-error")).toHaveTextContent("No scoreboard with that code"),
    );
    expect(store.getState().scoreboard.current).toBeNull();
    expect(screen.getByTestId("code-input")).toBeOnTheScreen();
  });

  it("blames the network when the request never left the device", async () => {
    service.joinScoreboard.mockRejectedValue(
      await transportFailureFrom(new Error("Network request failed")),
    );
    await renderPage();

    await pressJoinWith("ZZZZZZ");

    await waitFor(() =>
      expect(screen.getByTestId("form-error")).toHaveTextContent("Can't reach the server"),
    );
  });

  it("lets a code the client cannot encode reach the client, and reports what it said", async () => {
    service.joinScoreboard.mockRejectedValue(unencodableFailureFor(LONE_SURROGATE_CODE));
    await renderPage();

    await pressJoinWith(LONE_SURROGATE_CODE);

    expect(service.joinScoreboard).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.getByTestId("form-error")).toHaveTextContent(
        /Cannot build a request URL/,
      ),
    );
    expect(screen.queryByText("Can't reach the server")).toBeNull();
  });

  it("takes the last message away when the next attempt starts", async () => {
    service.joinScoreboard.mockRejectedValue(new ApiClientError("Scoreboard not found", 404));
    await renderPage();

    await pressJoinWith("ZZZZZZ");
    await waitFor(() =>
      expect(screen.getByTestId("form-error")).toHaveTextContent("No scoreboard with that code"),
    );

    await pressJoinWith("ab");

    expect(screen.getByTestId("form-error")).toHaveTextContent(
      "A scoreboard code is 6 characters",
    );
    expect(screen.queryByText("No scoreboard with that code")).toBeNull();
  });
});

describe("starting a game", () => {
  it.each([["", "empty"], ["   ", "whitespace only"]])(
    "refuses a name that is %p (%s) without sending anything",
    async (gameName) => {
      await renderPage();

      await pressCreateWith(gameName);

      expect(service.createScoreboard).not.toHaveBeenCalled();
      expect(screen.getByTestId("form-error")).toHaveTextContent("Give the game a name");
    },
  );

  it("sends the trimmed name and lands on the new board", async () => {
    const store = await renderPage();

    await pressCreateWith("  Catan  ");

    expect(service.createScoreboard).toHaveBeenCalledWith("Catan");
    await screen.findByTestId("current-board");
    expect(store.getState().scoreboard.current).toEqual(board);
  });

  it("says why a game the server refused was not created", async () => {
    service.createScoreboard.mockRejectedValue(new ApiClientError("Not found", 404));
    const store = await renderPage();

    await pressCreateWith("Catan");

    await waitFor(() =>
      expect(screen.getByTestId("form-error")).toHaveTextContent(
        "Couldn't create the scoreboard",
      ),
    );
    expect(store.getState().scoreboard.current).toBeNull();
  });
});

describe("while a request is in flight", () => {
  it("says so, and cannot be pressed a second time", async () => {
    const request = deferred<Scoreboard>();
    service.joinScoreboard.mockReturnValue(request.promise);
    await renderPage();

    await pressJoinWith("AB12CD");

    expect(screen.getByTestId("join-button")).toHaveTextContent("Joining...");
    expect(screen.getByTestId("join-button")).toBeDisabled();
    expect(screen.getByTestId("create-button")).toBeDisabled();

    await fireEvent.press(screen.getByTestId("join-button"));
    await fireEvent.press(screen.getByTestId("create-button"));

    expect(service.joinScoreboard).toHaveBeenCalledTimes(1);
    expect(service.createScoreboard).not.toHaveBeenCalled();

    await act(async () => {
      request.reject(new ApiClientError("Bad gateway", 502));
    });

    await waitFor(() =>
      expect(screen.getByTestId("form-error")).toHaveTextContent("Bad gateway"),
    );
    expect(screen.getByTestId("join-button")).toHaveTextContent("Join");
    expect(screen.getByTestId("join-button")).toBeEnabled();
  });

  it("says the create is under way too, and holds the join button as well", async () => {
    const request = deferred<Scoreboard>();
    service.createScoreboard.mockReturnValue(request.promise);
    await renderPage();

    await pressCreateWith("Catan");

    expect(screen.getByTestId("create-button")).toHaveTextContent("Creating...");
    expect(screen.getByTestId("create-button")).toBeDisabled();
    expect(screen.getByTestId("join-button")).toBeDisabled();

    await act(async () => {
      request.resolve(board);
    });

    await screen.findByTestId("current-board");
    expect(service.joinScoreboard).not.toHaveBeenCalled();
  });

  it("hands the form over to the board once the join succeeds", async () => {
    const request = deferred<Scoreboard>();
    service.joinScoreboard.mockReturnValue(request.promise);
    const store = await renderPage();

    await pressJoinWith("AB12CD");
    expect(screen.getByTestId("join-button")).toHaveTextContent("Joining...");

    await act(async () => {
      request.resolve(board);
    });

    await screen.findByTestId("current-board");
    expect(screen.queryByTestId("form-error")).toBeNull();
    expect(store.getState().scoreboard.current).toEqual(board);
  });
});

describe("with a game already open", () => {
  it("shows the game and its share code instead of the form", async () => {
    await renderPage((store) => store.dispatch(applyBoard(board)));

    expect(screen.getByTestId("current-board")).toBeOnTheScreen();
    expect(screen.getByText("Catan")).toBeOnTheScreen();
    expect(screen.getByTestId("current-code")).toHaveTextContent("AB12CD");
    expect(screen.queryByTestId("code-input")).toBeNull();
    expect(screen.queryByTestId("join-button")).toBeNull();
    expect(screen.queryByTestId("create-button")).toBeNull();
  });

  it("marks the share code as the one thing to read out", async () => {
    await renderPage((store) => store.dispatch(applyBoard(board)));

    expect(screen.getByTestId("current-code").props.className).toContain("text-primary");
  });
});
