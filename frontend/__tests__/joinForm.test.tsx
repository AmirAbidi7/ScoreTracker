/// <reference types="jest" />
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

/**
 * Only the gateway is faked, and it is the same gateway the scoreboard page's
 * tests fake: the real thunk, the real slice and the real component are all in
 * the loop. So every assertion below is a claim about what this form does —
 * about the code the server would receive, about the message a user would read
 * — rather than a recording of which functions the component happened to call.
 *
 * Mocking the thunks instead would be the cheaper arrangement, and it cannot
 * test the one thing this form exists to get right: an action creator that is
 * not a thunk hands `dispatch` a plain object, which carries no `meta` saying
 * whether it was rejected and nothing to unwrap — so "show the user why the
 * join failed" becomes untestable while still looking covered.
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

/** The board the server sends back: the form has no say in any of it. */
const board: Scoreboard = {
  id: "board-1",
  gameName: "Catan",
  code: "AB12CD",
  players: [{ id: 1, name: "Amir", score: 0 }],
  updateTime: "2026-09-25T10:00:00.000Z",
};

const makeStore = () => configureStore({ reducer: { scoreboard: reducer } });
type TestStore = ReturnType<typeof makeStore>;

/**
 * Seeded through the slice's own action before the page mounts, so the page
 * sees a store a real one could have produced — no hand-built state that no
 * reducer could ever have left behind.
 */
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

/**
 * The error a real dead network produces, run through the real client: React
 * Native's `fetch` rejection carries the platform's own wording, and the client
 * only substitutes "Can't reach the server" when the cause carries none — so
 * the message this test asserts is one the app actually reaches on its own.
 */
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

/**
 * The error for a code the client refuses to put in a URL, produced by the real
 * client so the discriminator is not hand-picked here: writing
 * `new ApiClientError(msg, 0, "unencodable-value")` by hand would make the
 * test an assertion about the literal it had just typed.
 */
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

/**
 * Six UTF-16 code units, one of which is an unpaired surrogate. It is a
 * six-character string as far as `length` is concerned — which is the whole
 * reason it can reach the client at all, and the reason the form's own check
 * must not turn it away first.
 */
const LONE_SURROGATE_CODE = "\uD800abcde";

/** A promise held open, to keep the form in its in-flight state. */
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
  /**
   * The paste is padded, lowercase and six characters long.
   *
   * Only the form can make this dispatch at all: untrimmed it is ten characters,
   * and the length check the form runs before dispatching is what refuses it.
   * That is also the honest limit of this test — the upper-casing is duplicated
   * in the thunk on purpose, so `"AB12CD"` at the service is the composition of
   * the two and nothing here can say which of them did it.
   */
  it("trims and uppercases a pasted code before it is sent", async () => {
    await renderPage();

    await pressJoinWith("  ab12cd  ");

    expect(service.joinScoreboard).toHaveBeenCalledTimes(1);
    expect(service.joinScoreboard).toHaveBeenCalledWith("AB12CD");
  });

  /**
   * None of these is a code the server generates, and each is turned away with
   * the reason spelled out and nothing sent. `"  ab  "` is the one that looks
   * like a code and is not: six characters of padding around four that matter.
   */
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
    // The server's code, which is the one anybody else has to type.
    expect(screen.getByTestId("current-code")).toHaveTextContent("AB12CD");
    expect(store.getState().scoreboard.current).toEqual(board);
    // The form has done its job and is no longer on offer.
    expect(screen.queryByTestId("code-input")).toBeNull();
  });

  it("says the code was not found when the server turns it down", async () => {
    service.joinScoreboard.mockRejectedValue(new ApiClientError("Scoreboard not found", 404));
    const store = await renderPage();

    await pressJoinWith("ZZZZZZ");

    await waitFor(() =>
      expect(screen.getByTestId("form-error")).toHaveTextContent("No scoreboard with that code"),
    );
    // A refused join leaves nothing behind: no board, and a form to try again
    // with, rather than a board the server never agreed to.
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

  /**
   * The case the length check could get wrong. A lone surrogate is one code
   * unit, so this string really is six characters long and really does belong
   * in a request — it is the client's URL encoding that refuses it, and the
   * client has an answer for that which is not "the network is down". Turning
   * it away in the form would replace a true diagnosis with a wrong one.
   */
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
    // The one thing this screen must not say: nothing was sent, so nothing was
    // unreachable.
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

    // A message the user has already acted on, left on screen under the answer
    // to what they did next, is a line they cannot get rid of.
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
    // One request at a time, whichever button is pressed: a second join would
    // be the same round trip twice, and a create would be two boards at once.
    expect(screen.getByTestId("create-button")).toBeDisabled();

    await fireEvent.press(screen.getByTestId("join-button"));
    await fireEvent.press(screen.getByTestId("create-button"));

    expect(service.joinScoreboard).toHaveBeenCalledTimes(1);
    expect(service.createScoreboard).not.toHaveBeenCalled();

    await act(async () => {
      request.reject(new ApiClientError("Bad gateway", 502));
    });

    // A button stuck on "Joining..." after the answer came back is a form the
    // user cannot use again, and the only reason they are still here.
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
    // There is no reason to rejoin the board the user is already in.
    expect(screen.queryByTestId("code-input")).toBeNull();
    expect(screen.queryByTestId("join-button")).toBeNull();
    expect(screen.queryByTestId("create-button")).toBeNull();
  });

  it("marks the share code as the one thing to read out", async () => {
    await renderPage((store) => store.dispatch(applyBoard(board)));

    // NativeWind resolves class names to styles no query can see, so the
    // `text-primary` the design calls for is only observable here.
    expect(screen.getByTestId("current-code").props.className).toContain("text-primary");
  });
});
