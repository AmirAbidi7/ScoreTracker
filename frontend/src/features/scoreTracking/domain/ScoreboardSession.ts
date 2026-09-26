import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * The version lives in the key, not in the value: the payload is only
 * `{ id, code }`, so a future shape change bumps this to `v2` and an older
 * build looks up a key that does not exist rather than misreading a shape it
 * does not understand. A version field inside the value could not help here —
 * an old build would have to parse the new value before it could notice the
 * version, which is the part that can fail.
 *
 * This entry outlives the build that wrote it. It survives app upgrades and
 * can be damaged by a partial write, a schema change, or a downgrade.
 */
const KEY = "playboard.session.v1";

export interface SavedSession {
  id: string;
  code: string;
}

/**
 * Turns one raw stored string into a session, or `null` if it is not one.
 *
 * Never throws. `JSON.parse` is the only operation here that can fail, and over
 * an app's lifetime a truncated or foreign value is expected rather than
 * exceptional, so the failure is folded into the same "not a session" answer as
 * a wrong shape. Every case below is a value the app must treat as "no
 * session": a non-object (`"abc"`, `5`), `null` (the literal string), an array,
 * an object missing `id`/`code` or holding a non-string for either, and a
 * blank `id`/`code` — a blank code is not a usable pointer, since the server
 * would reject it and the user would be left with no way back but retyping.
 *
 * The session is rebuilt field by field, so extra keys a future or past build
 * may have written are dropped rather than handed on.
 */
const parseStoredSession = (raw: string): SavedSession | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;

  const { id, code } = parsed as Record<string, unknown>;
  if (typeof id !== "string" || typeof code !== "string") return null;
  if (id.trim() === "" || code.trim() === "") return null;

  return { id, code };
};

/**
 * Only enough to get back in: the board id to re-read and the code to
 * re-subscribe. No auth exists, so this is a convenience pointer, not a
 * credential — nothing here is treated as a secret and no board data is kept.
 *
 * Every read is defensive. A corrupt or stale entry must not stop the app
 * booting, so anything unparseable is discarded and reported as "no session".
 *
 * The surrounding `try` is the guarantee that this never throws or rejects:
 * it also covers a storage read that fails outright, which is a real outcome
 * (full disk, unavailable native module) and not a bug in the entry. The
 * helpers below already absorb their own failures; this is the backstop that
 * keeps that true even if one of them is later changed to throw.
 */
export const readSavedSession = async (): Promise<SavedSession | null> => {
  try {
    // `raw === null` rather than `!raw`: an empty string is an entry, just not a
    // usable one, and `!raw` would answer "no session" while leaving it in
    // storage for every future launch to find again.
    const raw = await AsyncStorage.getItem(KEY);
    if (raw === null) return null;

    const session = parseStoredSession(raw);
    if (session) return session;

    // Unparseable or the wrong shape. Both are unrecoverable, so the entry is
    // dropped rather than left in place: a bad entry can only ever mislead a
    // later read, and leaving it means every future launch redoes this work.
    try {
      await clearSavedSession();
    } catch {
      // Best effort. The read has already answered "no session", and the next
      // launch retries the cleanup. Surfacing this would trade a harmless stale
      // entry for a boot-time failure.
    }

    return null;
  } catch {
    return null;
  }
};

/**
 * Persists only the two fields above, picked explicitly rather than
 * stringifying the argument: this is the boundary that keeps board data,
 * scores, and player lists out of storage, and a caller passing a wider object
 * (a `Scoreboard`, say) must not be able to widen what is written.
 *
 * Rejections are allowed and left to the caller. Being `async` means a
 * synchronous storage failure still arrives as a rejection instead of being
 * thrown at the call site.
 */
export const writeSavedSession = async (session: SavedSession): Promise<void> => {
  await AsyncStorage.setItem(KEY, JSON.stringify({ id: session.id, code: session.code }));
};

/** Rejections are allowed and left to the caller, for the same reason. */
export const clearSavedSession = async (): Promise<void> => {
  await AsyncStorage.removeItem(KEY);
};
