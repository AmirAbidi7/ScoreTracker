import { beforeAll, describe, expect, test } from "bun:test";

/**
 * A client must not be able to author a score.
 *
 * `PUT /api/scoreboard` took a whole board — `players`, `code`, `gameName` —
 * from the request body, wrote it and broadcast the result, which contradicted
 * the invariant every other path in this backend is built around: a client states
 * what changed, the server works out the board. Nothing in the app called it, so
 * it was removed rather than locked down, and this is what keeps it removed.
 *
 * Asserted on the router's own table rather than by asking for a response,
 * because "the route is not registered" is the property, and a request would only
 * report it as a 404 that some future middleware could turn into a 200.
 */
describe("the scoreboard routes", () => {
  let routes: string[];

  beforeAll(async () => {
    /*
     * Pointed at a dead local address on purpose. Importing the router builds
     * the app's layer, which constructs a connection pool — a pool opens no
     * connection until it is asked for one, and nothing here is — but there is
     * no reason to leave a handle to a shared remote database sitting in a test
     * process that must not talk to it.
     */
    process.env.DATABASE_URL = "postgres://nobody:nobody@127.0.0.1:1/none";
    const { scoreboardRouter } = await import("../routes/scoreboardController");
    routes = scoreboardRouter.stack
      .filter((layer) => layer.route)
      .map((layer) => `${Object.keys(layer.route.methods).join("/")} ${layer.route.path}`);
  });

  test("nothing accepts a client-authored board", () => {
    expect(routes).toEqual([
      "post/get /scoreboard",
      "get /scoreboard/join/:code",
      "get/delete /scoreboard/:id",
    ]);
  });

  test("the methods that stay are reads, a create and a delete", () => {
    // Named one by one, so a route added to that list above is a deliberate act
    // rather than a diff nobody read: any new line has to be answered for here.
    expect(routes).not.toContain("put /scoreboard");
    expect(routes).not.toContain("patch /scoreboard");
    expect(routes).not.toContain("put /scoreboard/:id");
    expect(routes).not.toContain("post /scoreboard/:id");
  });
});
