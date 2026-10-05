/// <reference types="jest" />
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  clearSavedSession,
  readSavedSession,
  writeSavedSession,
  type SavedSession,
} from "../src/features/scoreTracking/domain/ScoreboardSession";

const KEY = "playboard.session.v1";

const backing = () =>
  (AsyncStorage as unknown as { __INTERNAL_MOCK_STORAGE__: Record<string, string> })
    .__INTERNAL_MOCK_STORAGE__;

const seed = (raw: string) => {
  backing()[KEY] = raw;
};

const stored = () => backing()[KEY];

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
