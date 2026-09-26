/**
 * The one place a rejected thunk is turned into something a user can read.
 *
 * Three call sites need this answer — the slice, which stores it, and the two
 * pages, which put it on screen — and they were each answering it slightly
 * differently, which is how the same question ends up with two answers.
 */

/** The two fields of a rejected action that a reason can possibly be in. */
export interface RejectionCarrier {
  payload?: unknown;
  error?: { message?: string };
}

/** A message is worth showing only if there is something in it. */
const isAMessage = (candidate: unknown): candidate is string =>
  typeof candidate === "string" && candidate.trim().length > 0;

/**
 * RTK's own words, and the reason they are filtered out.
 *
 * A rejected action's `error` is built as `miniSerializeError(error || "Rejected")`,
 * so a thunk that rejected with nothing to say — `rejectWithValue()` with no
 * argument, or a throw of something that is not an `Error` — puts this literal on
 * `message`. It is RTK's placeholder for "there was no reason", not a
 * diagnosis, and a screen that renders it has told the user nothing while
 * looking as though it had.
 */
const RTK_PLACEHOLDER = "Rejected";

/**
 * What a rejected action is carrying, or `null` when it is carrying nothing worth
 * putting on screen.
 *
 * The payload first, and that order is the whole point. `rejectWithValue` puts
 * the thunk's own sentence in `payload` and leaves RTK's placeholder in
 * `error.message`; a thunk that *threw* puts a serialised error in `error` and
 * leaves `payload` undefined. So a reason read from `error` first answers a
 * perfectly good message with the word "Rejected", and a reason that fell
 * through from a blank payload to `error.message` does the same.
 *
 * A blank message is no message: storing `""` in a `string | null` field renders
 * an empty red banner, which is the silence this exists to prevent.
 *
 * Takes the rejected *action* rather than what `unwrap()` throws, because
 * `unwrap()` collapses "no payload" and "blank payload" into the same thrown
 * value — the two cases this has to tell apart.
 */
export const rejectionReason = (rejected: RejectionCarrier): string | null => {
  if (rejected.payload !== undefined) {
    return isAMessage(rejected.payload) ? rejected.payload : null;
  }
  const { message } = rejected.error ?? {};
  if (!isAMessage(message) || message === RTK_PLACEHOLDER) return null;
  return message;
};
