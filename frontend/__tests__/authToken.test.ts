/// <reference types="jest" />
jest.mock("@clerk/expo");
import { ApiClient } from "../infrastructure/api/client";
import {
  sendIntent,
  type SocketLike,
} from "../infrastructure/socket/scoreboardSocket";
import { ScoreboardService } from "../src/features/scoreTracking/domain/ScoreboardService";

const okJson = (value: unknown): Response =>
  ({ ok: true, status: 200, json: async () => value }) as Response;

describe("auth token reaches the REST transport", () => {
  test("the session token is sent as a bearer Authorization header", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ApiClient({
      baseUrl: "http://localhost:3000",
      fetchImpl: (async (url: string, init?: RequestInit) => {
        seen.push({ url, init });
        return okJson([]);
      }) as typeof fetch,
      tokenProvider: async () => "sess-token-123",
    });

    await client.listScoreboards();

    const headers = seen[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sess-token-123");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  test("reads stay anonymous when no token provider is configured", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ApiClient({
      baseUrl: "http://localhost:3000",
      fetchImpl: (async (url: string, init?: RequestInit) => {
        seen.push({ url, init });
        return okJson([]);
      }) as typeof fetch,
    });

    await client.listScoreboards();

    const headers = seen[0]?.init?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  test("claim posts to the claim endpoint with auth", async () => {
    const seen: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ApiClient({
      baseUrl: "http://localhost:3000",
      fetchImpl: (async (url: string, init?: RequestInit) => {
        seen.push({ url, init });
        return okJson({ id: "b1", ownerId: "user_abc" });
      }) as typeof fetch,
      tokenProvider: async () => "sess-token-123",
    });

    await client.claimScoreboard("b1");

    expect(seen[0]?.url).toBe("http://localhost:3000/api/scoreboard/b1/claim");
    expect((seen[0]?.init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer sess-token-123",
    );
  });
});

describe("auth token reaches the socket transport", () => {
  const emitted: Array<{ event: string; args: unknown[] }> = [];

  const socket: SocketLike = {
    connected: true,
    connect: () => {},
    disconnect: () => {},
    on: () => {},
    off: () => {},
    emit: (event: string, ...args: unknown[]) => {
      emitted.push({ event, args });
      const ack = args[args.length - 1];
      if (typeof ack === "function") {
        (ack as (response: unknown) => void)({ ok: false, code: 500, message: "unused" });
      }
    },
  };

  beforeEach(() => {
    emitted.length = 0;
  });

  test("the session token travels inside the scoreboard:intent payload", async () => {
    await sendIntent(socket, "AB12CD", { type: "addPlayer", name: "Bo" }, "sess-token-123");

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.event).toBe("scoreboard:intent");
    expect(emitted[0]?.args[0]).toEqual({
      code: "AB12CD",
      intent: { type: "addPlayer", name: "Bo" },
      token: "sess-token-123",
    });
  });

  test("the service resolves its token provider per intent", async () => {
    const board = {
      id: "board-1",
      gameName: "Catan",
      code: "AB12CD",
      players: [],
      updateTime: "2026-09-25T10:00:00.000Z",
      ownerId: "user_owner",
    };
    const service = new ScoreboardService({
      apiClient: new ApiClient({
        baseUrl: "http://localhost:3000",
        fetchImpl: (async () => okJson(board)) as typeof fetch,
      }),
      createSocket: () => socket,
      tokenProvider: async () => "sess-token-abc",
    });

    await service.joinScoreboard("AB12CD");
    emitted.length = 0;
    await service.sendIntent({ type: "addPlayer", name: "Bo" });

    expect(emitted[0]?.args[0]).toMatchObject({ code: "AB12CD", token: "sess-token-abc" });
  });
});
