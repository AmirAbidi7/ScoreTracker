/// <reference types="jest" />
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearSavedSession,
  readSavedSession,
  writeSavedSession,
  type SavedSession,
} from "../src/features/scoreTracking/domain/ScoreboardSession";

/**
 * Pinned rather than imported: `KEY` is module-private on purpose, and pinning
 * the string here means dropping the version suffix — the one thing that stops a
 * future build from being misread by an installed one — fails a test instead of
 * quietly orphaning every existing user's session.
 */
const KEY = "playboard.session.v1";

/** The mock's backing store, which the published `AsyncStorageStatic` type does not describe. */
const backing = () =>
  (AsyncStorage as unknown as { __INTERNAL_MOCK_STORAGE__: Record<string, string> })
    .__INTERNAL_MOCK_STORAGE__;

/** Seeds a raw entry, bypassing `setItem` so corrupt bytes can be written. */
const seed = (raw: string) => {
  backing()[KEY] = raw;
};

const stored = () => backing()[KEY];

/**
 * The storage mock's methods are already shared `jest.fn`s, and `jest.spyOn`
 * *reuses* a property that is already a mock instead of wrapping it. Both
 * consequences bite here: a spy inherits call history from earlier tests, and a
 * `...Once` implementation queued by a test that never consumes it leaks into
 * whichever later test calls that method — turning one real failure into a
 * cascade of phantom ones.
 *
 * So every test gets freshly built wrappers delegating to the pristine
 * originals. History and once-queues start empty and cannot escape the test that
 * created them, and the wrappers are still mocks, so `not.toHaveBeenCalled()`
 * stays meaningful.
 */
const pristine = {
  getItem: AsyncStorage.getItem,
  setItem: AsyncStorage.setItem,
  removeItem: AsyncStorage.removeItem,
} as const;

const makeStorageMock = () => ({
  getItem: jest.fn(pristine.getItem) as jest.Mock,
  setItem: jest.fn(pristine.setItem) as jest.Mock,
  removeItem: jest.fn(pristine.removeItem) as jest.Mock,
});

let storage: ReturnType<typeof makeStorageMock>;

beforeEach(async () => {
  await AsyncStorage.clear();
  storage = makeStorageMock();
  Object.assign(AsyncStorage, storage);
});

describe("readSavedSession", () => {
  test("returns null and leaves storage alone when no entry exists", async () => {
    expect(await readSavedSession()).toBeNull();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  test("returns a valid entry", async () => {
    seed(JSON.stringify({ id: "board-1", code: "AB12CD" }));

    expect(await readSavedSession()).toEqual({ id: "board-1", code: "AB12CD" });
  });

  test("round-trips a session written by writeSavedSession", async () => {
    await writeSavedSession({ id: "board-9", code: "ZZ99YY" });

    expect(await readSavedSession()).toEqual({ id: "board-9", code: "ZZ99YY" });
  });

  test("accepts an entry padded with surrounding whitespace", async () => {
    seed('  {"id":"board-1","code":"AB12CD"}  ');

    expect(await readSavedSession()).toEqual({ id: "board-1", code: "AB12CD" });
  });

  test("drops keys it does not recognise instead of handing them on", async () => {
    seed(
      JSON.stringify({
        id: "board-1",
        code: "AB12CD",
        gameName: "Catan",
        players: [{ name: "Amir", score: 3 }],
      }),
    );

    expect(await readSavedSession()).toEqual({ id: "board-1", code: "AB12CD" });
  });

  /**
   * The assertion this file exists for.
   *
   * A partial write is the most likely corruption, and it is the one the
   * original implementation got wrong: its `removeItem(KEY)` sat after the shape
   * check, so a `JSON.parse` throw jumped straight to the `catch` and returned
   * `null` while leaving the corrupt entry in place — meaning every future
   * launch re-ran the failing parse forever. Returning `null` is only half the
   * contract; the entry has to go as well.
   */
  test.each([
    ["a truncated write", '{"id":"board-1","co'],
    ["a bare word", "not json at all"],
    ["a trailing comma", '{"id":"board-1","code":"AB12CD",}'],
    ["a single quote", "{'id':'board-1','code':'AB12CD'}"],
    ["an unterminated string", '{"id":"board-1","code":"AB12CD'],
    ["a UTF-8 BOM", '\uFEFF{"id":"board-1","code":"AB12CD"}'],
    ["an HTML error page", "<!doctype html><h1>500</h1>"],
    [
      "nesting deep enough to overflow the stack",
      `${"[".repeat(200_000)}${"]".repeat(200_000)}`,
    ],
  ])("discards malformed JSON from %s", async (_label, raw) => {
    seed(raw);

    expect(await readSavedSession()).toBeNull();
    expect(stored()).toBeUndefined();
  });

  /**
   * The deliberate converse of the assertion above.
   *
   * A failed read is not a corrupt entry — it is a native module that was not
   * ready, a bridge hiccup, a full disk. Deleting on that basis would cost
   * someone their place in a game they are still playing, and the symptom
   * ("the app sometimes forgets my game") is precisely what this module exists to
   * prevent. Nothing is known about the entry, so nothing may be removed.
   */
  test("returns null without deleting the entry when the storage read fails", async () => {
    seed(JSON.stringify({ id: "board-1", code: "AB12CD" }));
    storage.getItem.mockRejectedValueOnce(new Error("native module not ready"));

    expect(await readSavedSession()).toBeNull();
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(stored()).toBe('{"id":"board-1","code":"AB12CD"}');
  });

  test.each([
    ["a bare string", '"AB12CD"'],
    ["a number", "5"],
    ["a boolean", "true"],
    ["the literal null", "null"],
    ["an empty array", "[]"],
    ["an array holding a session", '[{"id":"board-1","code":"AB12CD"}]'],
  ])("discards valid JSON of the wrong shape: %s", async (_label, raw) => {
    seed(raw);

    expect(await readSavedSession()).toBeNull();
    expect(stored()).toBeUndefined();
  });

  test.each([
    ["an empty object", "{}"],
    ["a missing code", '{"id":"board-1"}'],
    ["a missing id", '{"code":"AB12CD"}'],
    ["a numeric id", '{"id":7,"code":"AB12CD"}'],
    ["a null code", '{"id":"board-1","code":null}'],
    ["an object code", '{"id":"board-1","code":{"value":"AB12CD"}}'],
    ["an array code", '{"id":"board-1","code":["AB12CD"]}'],
  ])("discards a session with a non-string field: %s", async (_label, raw) => {
    seed(raw);

    expect(await readSavedSession()).toBeNull();
    expect(stored()).toBeUndefined();
  });

  /**
   * A blank field is garbage, not a session: the server would reject the code
   * and the user would be back on the Join screen with no way forward.
   */
  test.each([
    ["a blank id and code", '{"id":"","code":""}'],
    ["a blank code", '{"id":"board-1","code":""}'],
    ["a whitespace-only code", '{"id":"board-1","code":"   "}'],
    ["a whitespace-only id", '{"id":" \\n ","code":"AB12CD"}'],
    ["a tab-only code", '{"id":"board-1","code":"\\t"}'],
  ])("discards a blank pointer: %s", async (_label, raw) => {
    seed(raw);

    expect(await readSavedSession()).toBeNull();
    expect(stored()).toBeUndefined();
  });

  /**
   * The storage mock cannot express this one: its `getItem` reads
   * `storage[key] || null`, which collapses a stored `""` to `null`, and its
   * `removeItem` skips falsy entries, so the delete could not be observed in the
   * backing store either. The real `getItem` returns the empty string it was
   * given, so the read has to cope with it — hence the per-test wrapper override
   * and the assertion on the call rather than on the store.
   */
  test("treats an empty-string entry as absent and cleans it up", async () => {
    seed("");
    storage.getItem.mockResolvedValueOnce("");

    expect(await readSavedSession()).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(KEY);
  });

  test("does not let a stored __proto__ key reach the prototype", async () => {
    seed('{"id":"board-1","code":"AB12CD","__proto__":{"polluted":true}}');

    expect(await readSavedSession()).toEqual({ id: "board-1", code: "AB12CD" });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("returns null without throwing when the storage read rejects", async () => {
    seed(JSON.stringify({ id: "board-1", code: "AB12CD" }));
    storage.getItem.mockRejectedValueOnce(new Error("storage unavailable"));

    await expect(readSavedSession()).resolves.toBeNull();
  });

  test("returns null without throwing when the storage read throws synchronously", async () => {
    storage.getItem.mockImplementationOnce(() => {
      throw new Error("native module missing");
    });

    await expect(readSavedSession()).resolves.toBeNull();
    expect(storage.removeItem).not.toHaveBeenCalled();
  });

  /**
   * `getItem` is typed `string | null`, so `undefined` means a broken runtime or
   * a careless mock rather than a real stored value. It is still a read that
   * produced no session, and the entry is no more usable than a corrupt one, so
   * it is cleaned up on the same path.
   *
   * This is the case that pins `raw === null` over a truthiness check. Under
   * `!raw` the read would answer `null` here just the same, and the only
   * observable difference is the missing `removeItem` call — which is what this
   * asserts.
   */
  test("discards the entry when the storage read resolves undefined", async () => {
    seed(JSON.stringify({ id: "board-1", code: "AB12CD" }));
    storage.getItem.mockResolvedValueOnce(undefined);

    expect(await readSavedSession()).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledWith(KEY);
    expect(stored()).toBeUndefined();
  });

  test("returns null without throwing when cleanup rejects", async () => {
    seed("not json at all");
    storage.removeItem.mockRejectedValueOnce(new Error("storage unavailable"));

    // The read has already decided there is no session; a failed delete must not
    // turn that into a boot-time failure. The next launch retries the cleanup.
    await expect(readSavedSession()).resolves.toBeNull();
  });

  test("returns null without throwing when cleanup throws synchronously", async () => {
    seed("not json at all");
    storage.removeItem.mockImplementationOnce(() => {
      throw new Error("native module missing");
    });

    await expect(readSavedSession()).resolves.toBeNull();
  });

  test("ignores an entry stored under a different key", async () => {
    backing()["playboard.session.v2"] = JSON.stringify({ id: "b", code: "C" });

    expect(await readSavedSession()).toBeNull();
  });
});

describe("writeSavedSession", () => {
  test("persists only id and code", async () => {
    await writeSavedSession({ id: "board-1", code: "AB12CD" });

    expect(stored()).toBe('{"id":"board-1","code":"AB12CD"}');
  });

  test("does not persist board data a wider caller passed by mistake", async () => {
    // A `Scoreboard` handed to this function must not put scores or a player
    // list on disk: the session is a pointer, not a cache.
    await writeSavedSession({
      id: "board-1",
      code: "AB12CD",
      gameName: "Catan",
      players: [{ id: 1, name: "Amir", score: 3 }],
      updateTime: "2026-09-25T10:00:00.000Z",
    } as unknown as SavedSession);

    expect(stored()).toBe('{"id":"board-1","code":"AB12CD"}');
    expect(stored()).not.toContain("players");
    expect(stored()).not.toContain("score");
  });

  /**
   * A no-op rather than a throw: callers will not await this, so a throw would
   * surface as an unhandled rejection in a later task's async flow. Writing a
   * blank code would only manufacture an entry the next read has to delete.
   */
  test.each([
    ["a blank code", { id: "board-1", code: "" }],
    ["a blank id", { id: "", code: "AB12CD" }],
    ["both blank", { id: "", code: "" }],
    ["a whitespace-only code", { id: "board-1", code: "   " }],
    ["a numeric id", { id: 7, code: "AB12CD" }],
    ["a null code", { id: "board-1", code: null }],
    ["both missing", {}],
  ])("refuses to persist %s, and does not throw", async (_label, session) => {
    await expect(
      writeSavedSession(session as unknown as SavedSession),
    ).resolves.toBeUndefined();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(stored()).toBeUndefined();
  });

  test("leaves an existing good session alone when refusing to write", async () => {
    await writeSavedSession({ id: "board-1", code: "AB12CD" });

    await writeSavedSession({ id: "", code: "" });

    expect(await readSavedSession()).toEqual({ id: "board-1", code: "AB12CD" });
  });

  test("surfaces a storage rejection to the caller", async () => {
    storage.setItem.mockRejectedValueOnce(new Error("storage full"));

    await expect(writeSavedSession({ id: "b", code: "C" })).rejects.toThrow(
      "storage full",
    );
  });

  test("turns a synchronous storage failure into a rejection, not a throw", async () => {
    storage.setItem.mockImplementationOnce(() => {
      throw new Error("native module missing");
    });

    // Being `async` is load-bearing: a throw here must not escape at the call
    // site, where a caller that does not await would turn it into an unhandled
    // rejection.
    const pending = writeSavedSession({ id: "b", code: "C" });

    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).rejects.toThrow("native module missing");
  });
});

describe("clearSavedSession", () => {
  test("removes the entry", async () => {
    await writeSavedSession({ id: "board-1", code: "AB12CD" });

    await clearSavedSession();

    expect(stored()).toBeUndefined();
    expect(await readSavedSession()).toBeNull();
  });

  test("is a no-op when there is no entry", async () => {
    await expect(clearSavedSession()).resolves.toBeUndefined();
  });

  test("turns a synchronous storage failure into a rejection, not a throw", async () => {
    storage.removeItem.mockImplementationOnce(() => {
      throw new Error("native module missing");
    });

    const pending = clearSavedSession();

    expect(pending).toBeInstanceOf(Promise);
    await expect(pending).rejects.toThrow("native module missing");
  });
});
