import { beforeAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { Server } from "socket.io";
import { UnauthorizedError } from "../errors/errors";
import type {
  ScoreboardAck,
  ScoreboardHandlerDeps,
} from "../socket/scoreboardHandlers";
import { verifySessionTokenLive } from "../utils/auth";

let registerScoreboardHandlers: (io: Server, deps?: ScoreboardHandlerDeps) => void = () => {
  throw new Error("not loaded");
};

beforeAll(async () => {
  process.env.DATABASE_URL = "postgres://nobody:nobody@127.0.0.1:1/none";
  ({ registerScoreboardHandlers } = await import("../socket/scoreboardHandlers"));
});

type Handler = (...args: any[]) => void;

const makeSocket = () => {
  const handlers = new Map<string, Handler>();
  const joined: string[] = [];
  return {
    handlers,
    joined,
    on: (event: string, handler: Handler) => {
      handlers.set(event, handler);
    },
    join: (room: string) => {
      joined.push(room);
      return Promise.resolve();
    },
    leave: () => Promise.resolve(),
    fire: (event: string, ...args: any[]) => handlers.get(event)?.(...args),
  };
};

const setup = (overrides?: ScoreboardHandlerDeps) => {
  let connection: Handler | null = null;
  const io = {
    on: (event: string, handler: Handler) => {
      if (event === "connection") connection = handler;
    },
  };
  registerScoreboardHandlers(io as unknown as Server, overrides);
  const socket = makeSocket();
  (connection as unknown as (...args: any[]) => void)(socket as never);
  return socket;
};

const board = {
  id: "11111111-1111-1111-1111-111111111111",
  gameName: "Catan",
  code: "AB12CD",
  players: [],
  updateTime: new Date("2026-09-25T10:00:00.000Z").toISOString(),
  ownerId: "user_owner",
};

describe("socket: intents require a session token", () => {
  beforeAll(() => {
    process.env.DATABASE_URL = "postgres://nobody:nobody@127.0.0.1:1/none";
  });

  test("an intent without a token is refused with a 401-shaped ack", async () => {
    let verified = false;
    const socket = setup({
      verify: () =>
        Effect.sync(() => {
          verified = true;
          return { userId: "user_abc" };
        }),
    });
    const acks: ScoreboardAck[] = [];
    socket.fire("scoreboard:intent", { code: "AB12CD", intent: { type: "addPlayer", name: "Bo" } }, (ack: ScoreboardAck) => {
      acks.push(ack);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(verified).toBe(false);
    expect(acks).toEqual([{ ok: false, code: 401, message: "Sign in to change this board" }]);
  });

  test("an intent with a rejected token is refused with a 401-shaped ack", async () => {
    const updated: unknown[] = [];
    const socket = setup({
      verify: () => Effect.fail(new UnauthorizedError({ message: "Invalid or expired session" })),
      intentService: {
        applyIntentToCode: () => Effect.succeed(board),
      },
      socketService: {
        updateScoreboard: (scoreboard) =>
          Effect.sync(() => {
            updated.push(scoreboard);
          }),
        disconnectFromScoreboard: () => Effect.void,
      },
    });
    const acks: ScoreboardAck[] = [];
    socket.fire(
      "scoreboard:intent",
      { code: "AB12CD", intent: { type: "addPlayer", name: "Bo" }, token: "bad-token" },
      (ack: ScoreboardAck) => {
        acks.push(ack);
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(acks).toEqual([{ ok: false, code: 401, message: "Sign in to change this board" }]);
    expect(updated).toEqual([]);
  });

  test("a verified intent applies and still broadcasts to the room", async () => {
    const updated: unknown[] = [];
    const socket = setup({
      verify: () => Effect.succeed({ userId: "user_joiner" }),
      intentService: {
        applyIntentToCode: (code, _intent, userId) =>
          Effect.succeed({ ...board, code, ownerId: userId ?? "user_owner" }),
      },
      socketService: {
        updateScoreboard: (scoreboard) =>
          Effect.sync(() => {
            updated.push(scoreboard);
          }),
        disconnectFromScoreboard: () => Effect.void,
      },
    });
    const acks: ScoreboardAck[] = [];
    socket.fire(
      "scoreboard:intent",
      { code: "AB12CD", intent: { type: "addPlayer", name: "Bo" }, token: "good-token" },
      (ack: ScoreboardAck) => {
        acks.push(ack);
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(acks[0]?.ok).toBe(true);
    expect(updated).toHaveLength(1);
  });

  test("room joins stay public so guests receive broadcasts", () => {
    const socket = setup({
      verify: () => Effect.fail(new UnauthorizedError({ message: "nope" })),
    });
    socket.fire("scoreboard:join", { code: "AB12CD" });
    expect(socket.joined).toEqual(["scoreboard:AB12CD"]);
  });

  test("the live verifier refuses without a configured secret", async () => {
    delete process.env.CLERK_SECRET_KEY;
    const result = await Effect.runPromise(Effect.result(verifySessionTokenLive("any-token")));
    expect(result._tag).toBe("Failure");
  });

  test("a verified token is reused within the TTL instead of re-verified", async () => {
    let calls = 0;
    const updated: unknown[] = [];
    const socket = setup({
      verify: () =>
        Effect.sync(() => {
          calls += 1;
          return { userId: "user_joiner" };
        }),
      intentService: {
        applyIntentToCode: () => Effect.succeed(board),
      },
      socketService: {
        updateScoreboard: (scoreboard) =>
          Effect.sync(() => {
            updated.push(scoreboard);
          }),
        disconnectFromScoreboard: () => Effect.void,
      },
    });
    const acks: ScoreboardAck[] = [];
    const payload = { code: "AB12CD", intent: { type: "addPlayer", name: "Bo" }, token: "same-token" };
    socket.fire("scoreboard:intent", payload, (ack: ScoreboardAck) => {
      acks.push(ack);
    });
    socket.fire("scoreboard:intent", payload, (ack: ScoreboardAck) => {
      acks.push(ack);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(acks.filter((ack) => ack.ok)).toHaveLength(2);
    expect(calls).toBe(1);
    expect(updated).toHaveLength(2);
  });

  test("a revoked token is refused once the TTL expires", async () => {
    let revoked = false;
    const updated: unknown[] = [];
    const socket = setup({
      verify: () =>
        revoked
          ? Effect.fail(new UnauthorizedError({ message: "Invalid or expired session" }))
          : Effect.succeed({ userId: "user_joiner" }),
      intentService: {
        applyIntentToCode: () => Effect.succeed(board),
      },
      socketService: {
        updateScoreboard: (scoreboard) =>
          Effect.sync(() => {
            updated.push(scoreboard);
          }),
        disconnectFromScoreboard: () => Effect.void,
      },
      verifiedTokenTtlMs: 5,
    });
    const acks: ScoreboardAck[] = [];
    const payload = { code: "AB12CD", intent: { type: "addPlayer", name: "Bo" }, token: "revoked-soon" };
    socket.fire("scoreboard:intent", payload, (ack: ScoreboardAck) => {
      acks.push(ack);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(acks[0]?.ok).toBe(true);

    revoked = true;
    await new Promise((resolve) => setTimeout(resolve, 15));
    socket.fire("scoreboard:intent", payload, (ack: ScoreboardAck) => {
      acks.push(ack);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(acks[1]).toEqual({ ok: false, code: 401, message: "Sign in to change this board" });
    expect(updated).toHaveLength(1);
  });
});
