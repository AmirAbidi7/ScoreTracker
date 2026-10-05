import { beforeAll, describe, expect, test } from "bun:test";

describe("the scoreboard routes", () => {
  let routes: string[];

  beforeAll(async () => {
    process.env.DATABASE_URL = "postgres://nobody:nobody@127.0.0.1:1/none";
    const { scoreboardRouter } = await import("../routes/scoreboardController");
    routes = scoreboardRouter.stack.flatMap((layer) => {
      const route = layer.route;
      if (!route) return [];
      return route.stack.map((handler) => `${handler.method} ${route.path}`);
    });
  });

  test("nothing accepts a client-authored board", () => {
    expect(routes).toEqual([
      "post /scoreboard",
      "get /scoreboard",
      "get /scoreboard/join/:code",
      "get /scoreboard/:id",
      "delete /scoreboard/:id",
    ]);
  });

  test("the methods that stay are reads, a create and a delete", () => {
    expect(routes).not.toContain("put /scoreboard");
    expect(routes).not.toContain("patch /scoreboard");
    expect(routes).not.toContain("put /scoreboard/:id");
    expect(routes).not.toContain("post /scoreboard/:id");
  });
});
