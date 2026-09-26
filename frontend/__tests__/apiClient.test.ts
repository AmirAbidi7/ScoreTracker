/// <reference types="jest" />
import { ApiClient, ApiClientError } from "../infrastructure/api/client";

const ok = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );

const makeClient = (fetchImpl: typeof fetch) =>
  new ApiClient({ baseUrl: "http://api.test", fetchImpl });

/** Awaits a rejection and hands back the reason, so both type and shape can be asserted. */
const captureError = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error("expected the request to reject, but it resolved");
    },
    (reason: unknown) => reason,
  );

/**
 * The synchronous counterpart, for the one failure thrown before a promise
 * exists: `encodePathSegment` rejects its input by throwing, and the client
 * methods are not `async`.
 */
const captureThrown = (call: () => unknown): unknown => {
  try {
    call();
  } catch (error: unknown) {
    return error;
  }
  throw new Error("expected the call to throw, but it returned");
};

const board = {
  id: "11111111-1111-1111-1111-111111111111",
  gameName: "Catan",
  code: "AB12CD",
  players: [{ id: 1, name: "Amir", score: 3 }],
  updateTime: "2026-09-25T10:00:00.000Z",
};

describe("ApiClient", () => {
  test("createScoreboard posts the wrapped body and returns the board", async () => {
    const fetchImpl = jest.fn().mockReturnValue(
      Promise.resolve(
        new Response(JSON.stringify(board), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    const result = await makeClient(fetchImpl).createScoreboard("Catan");

    expect(result).toEqual(board);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/api/scoreboard",
      expect.objectContaining({ method: "POST" }),
    );
    const [, init] = (fetchImpl as unknown as jest.Mock).mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      scoreboard: { gameName: "Catan" },
    });
  });

  test("joinScoreboard encodes the code in the path", async () => {
    // The code is typed by the user on the join screen, so it can be anything:
    // an unencoded "../" would address a different endpoint entirely.
    const fetchImpl = jest.fn().mockReturnValue(ok(board)) as unknown as typeof fetch;

    await makeClient(fetchImpl).joinScoreboard("AB 12/CD");

    expect(fetchImpl).toHaveBeenCalledWith(
      "http://api.test/api/scoreboard/join/AB%2012%2FCD",
      expect.anything(),
    );
  });

  test("getScoreboard requests a board by id", async () => {
    const fetchImpl = jest.fn().mockReturnValue(ok(board)) as unknown as typeof fetch;

    await expect(makeClient(fetchImpl).getScoreboard(board.id)).resolves.toEqual(board);
    expect(fetchImpl).toHaveBeenCalledWith(
      `http://api.test/api/scoreboard/${board.id}`,
      expect.anything(),
    );
  });

  test("a 404 on join becomes an ApiClientError carrying the status", async () => {
    // A fresh Response per call: a body can only be read once, and this test
    // makes two calls against the same mock.
    const fetchImpl = jest.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "not found", code: 404 }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    ) as unknown as typeof fetch;

    await expect(makeClient(fetchImpl).joinScoreboard("ZZZZZZ")).rejects.toBeInstanceOf(
      ApiClientError,
    );
    await expect(makeClient(fetchImpl).joinScoreboard("ZZZZZZ")).rejects.toMatchObject({
      status: 404,
      message: "not found",
    });
  });

  test("a non-JSON error body still produces a usable message", async () => {
    const fetchImpl = jest.fn().mockReturnValue(
      Promise.resolve(new Response("<html>502 Bad Gateway</html>", { status: 502 })),
    ) as unknown as typeof fetch;

    const error = (await captureError(makeClient(fetchImpl).listScoreboards())) as ApiClientError;

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.status).toBe(502);
    // The proxy's HTML must not reach the UI as an error message.
    expect(error.message).toBe("Request failed with status 502");
  });

  test("a network failure produces an ApiClientError with status 0", async () => {
    const fetchImpl = jest
      .fn()
      .mockRejectedValue(new TypeError("Network request failed")) as unknown as typeof fetch;

    const error = await makeClient(fetchImpl)
      .listScoreboards()
      .catch((e: unknown) => e as ApiClientError);

    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).status).toBe(0);
  });

  test("isOffline is true only for a request that never reached the server", async () => {
    const unreachable = makeClient(
      jest.fn().mockRejectedValue(new TypeError("Network request failed")) as unknown as typeof fetch,
    );
    const broken = makeClient(
      jest
        .fn()
        .mockReturnValue(
          Promise.resolve(
            new Response(JSON.stringify({ message: "boom", code: 500 }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }),
          ),
        ) as unknown as typeof fetch,
    );

    const transport = (await captureError(unreachable.listScoreboards())) as ApiClientError;
    const serverSide = (await captureError(broken.listScoreboards())) as ApiClientError;

    expect(transport).toBeInstanceOf(ApiClientError);
    expect(serverSide).toBeInstanceOf(ApiClientError);
    expect(transport.status).toBe(0);
    expect(transport.isOffline).toBe(true);
    expect(serverSide.status).toBe(500);
    expect(serverSide.isOffline).toBe(false);
  });

  test("a successful response with a non-JSON body is still an ApiClientError", async () => {
    // The misconfigured-base-URL case: a wrong host (e.g. Metro on :8081)
    // answers 200 with the router's HTML, so `response.json()` would throw a
    // bare SyntaxError straight at the caller.
    const fetchImpl = jest.fn().mockReturnValue(
      Promise.resolve(new Response("<!doctype html><title>Metro</title>", { status: 200 })),
    ) as unknown as typeof fetch;

    const error = (await captureError(makeClient(fetchImpl).listScoreboards())) as ApiClientError;

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.status).toBe(200);
    expect(error.message).toBe("Malformed response from server (status 200)");
  });

  test("a fetch that rejects with a non-Error is still an ApiClientError", async () => {
    // Nothing guarantees `fetch` rejects with an Error; a polyfill or a test
    // double may reject with a bare string, and the caller must still get the
    // one error type.
    const fetchImpl = jest.fn().mockRejectedValue("boom") as unknown as typeof fetch;

    const error = (await captureError(makeClient(fetchImpl).listScoreboards())) as ApiClientError;

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.status).toBe(0);
    expect(error.message).toBe("Can't reach the server");
  });

  test("a path segment that cannot be encoded throws instead of leaking a URIError", () => {
    // An unpaired surrogate, which `encodeURIComponent` rejects. The throw is
    // synchronous — the method is not `async` — but it must still be the one
    // error type rather than a raw `URIError`.
    const fetchImpl = jest.fn().mockReturnValue(ok(board)) as unknown as typeof fetch;

    expect(() => makeClient(fetchImpl).joinScoreboard("\uD800")).toThrow(ApiClientError);
    expect(() => makeClient(fetchImpl).joinScoreboard("\uD800")).toThrow(
      'Cannot build a request URL from "\\ud800"',
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("the two status 0 failures are told apart by failure, not by status", async () => {
    // Both never reached the server, so `status` is `0` for both and has to
    // stay `0` for both — `isOffline` means "never reached the server" and
    // nothing may repurpose it. `failure` is the only thing that separates a
    // dead network from a request this client refused to build, and a UI that
    // gets it wrong either blames the network for the user's typing or hides
    // a dead one behind a raw platform string.
    const unreachable = makeClient(
      jest.fn().mockRejectedValue(new TypeError("Network request failed")) as unknown as typeof fetch,
    );
    const unencodable = makeClient(jest.fn().mockReturnValue(ok(board)) as unknown as typeof fetch);

    const transport = (await captureError(unreachable.listScoreboards())) as ApiClientError;
    const unbuilt = captureThrown(() => unencodable.joinScoreboard("\uD800")) as ApiClientError;

    // The shared half: neither reached the server, so both are offline.
    expect(transport.status).toBe(0);
    expect(unbuilt.status).toBe(0);
    expect(transport.isOffline).toBe(true);
    expect(unbuilt.isOffline).toBe(true);

    // The part that has to differ.
    expect(transport.failure).toBe("transport");
    expect(unbuilt.failure).toBe("unencodable-value");

    // And the transport error keeps the platform's own wording, so a UI that
    // shows `message` verbatim would show "Network request failed".
    expect(transport.message).toBe("Network request failed");
  });

  test("failure defaults to transport for every other error this client reports", async () => {
    // A real HTTP status, a body that could not be parsed, and a rejection
    // carrying no message all describe the same thing to a user: talking to
    // the server went wrong. None is the unbuildable-request case, and none
    // should need to pass a tag to say so.
    const serverError = makeClient(
      jest
        .fn()
        .mockReturnValue(
          Promise.resolve(
            new Response(JSON.stringify({ message: "boom", code: 500 }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            }),
          ),
        ) as unknown as typeof fetch,
    );
    const unreadable = makeClient(
      jest
        .fn()
        .mockReturnValue(
          Promise.resolve(new Response("<!doctype html>", { status: 200 })),
        ) as unknown as typeof fetch,
    );
    const silent = makeClient(jest.fn().mockRejectedValue("boom") as unknown as typeof fetch);

    for (const error of [
      (await captureError(serverError.listScoreboards())) as ApiClientError,
      (await captureError(unreadable.listScoreboards())) as ApiClientError,
      (await captureError(silent.listScoreboards())) as ApiClientError,
    ]) {
      expect(error.failure).toBe("transport");
    }
  });

  test("deleteScoreboard resolves undefined on a 204 and sends DELETE", async () => {
    const fetchImpl = jest
      .fn()
      .mockReturnValue(Promise.resolve(new Response(null, { status: 204 }))) as unknown as typeof fetch;

    await expect(makeClient(fetchImpl).deleteScoreboard(board.id)).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      `http://api.test/api/scoreboard/${board.id}`,
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});
