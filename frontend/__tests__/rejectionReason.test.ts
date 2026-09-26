/// <reference types="jest" />
import {
  rejectionReason,
  type RejectionCarrier,
} from "../src/features/scoreTracking/rejectionReason";

/**
 * The one policy three call sites share, tested on its own because the arms that
 * decide it were covered nowhere: every caller exercised the easy case — a thunk
 * that rejected with a sentence — so the two arms that are only reached when a
 * thunk misbehaves had never been run.
 *
 * The shapes below are the ones RTK actually produces, read off
 * `createAsyncThunk` in `@reduxjs/toolkit`: a rejected action carries `payload`
 * when the thunk called `rejectWithValue` and `error` built as
 * `miniSerializeError(error || "Rejected")` always.
 */
describe("a reason in the payload", () => {
  it("is the thunk's own sentence", () => {
    expect(rejectionReason({ payload: "No scoreboard with that code" })).toBe(
      "No scoreboard with that code",
    );
  });

  /**
   * The load-bearing one. RTK leaves its placeholder in `error.message` beside
   * every good payload, so a reason read from `error` first would answer a
   * perfectly good rejection with the word "Rejected" — and the user would be
   * told the library ran out of words rather than what the server said.
   */
  it("wins over the placeholder RTK leaves in `error`", () => {
    expect(
      rejectionReason({ payload: "Bad gateway", error: { message: "Rejected" } }),
    ).toBe("Bad gateway");
  });

  it.each([["", "empty"], ["   ", "whitespace only"]])(
    "is no reason when it is %p (%s), and does not fall through to `error`",
    (payload) => {
      // Answering with the placeholder here is the trap this order exists to
      // avoid: a blank payload is "nothing to say", not "the server said
      // Rejected".
      expect(rejectionReason({ payload, error: { message: "Rejected" } })).toBeNull();
    },
  );

  it("is no reason when the payload is something other than a message", () => {
    // A payload that is not text cannot be shown, and showing `String(...)` of it
    // would put an object's shape in front of the user as though it were a
    // diagnosis.
    expect(rejectionReason({ payload: { code: 500 } })).toBeNull();
  });
});

describe("a reason in a serialised error", () => {
  /**
   * A thunk that *threw* rather than calling `rejectWithValue` leaves nothing in
   * `payload`, and its reason is here. Nothing in the app does this today, so
   * this arm is the one that has never run.
   */
  it("is the thrown error's message", () => {
    expect(rejectionReason({ payload: undefined, error: { message: "Bad gateway" } })).toBe(
      "Bad gateway",
    );
  });

  it("is read when there is no `error` key at all", () => {
    expect(rejectionReason({})).toBeNull();
    expect(rejectionReason({ payload: undefined })).toBeNull();
  });

  /**
   * `miniSerializeError(error || "Rejected")` puts this literal on `message` for
   * anything thrown with no message of its own — `rejectWithValue()` with no
   * argument, or a throw of `{}`. It is RTK's way of saying "there was no
   * reason", and rendering it would be a screen that looks informed and is not.
   */
  it("is not the placeholder RTK substitutes for a reason nobody gave", () => {
    expect(rejectionReason({ payload: undefined, error: { message: "Rejected" } })).toBeNull();
  });

  // Typed as one table rather than left to `each`'s inference over a union of
  // tuples, which widens the callback's own parameter to a signature nothing
  // satisfies.
  const NOTHING_SAYING: Array<[string | undefined, string]> = [
    ["", "empty"],
    ["  ", "whitespace only"],
    [undefined, "absent"],
  ];

  it.each(NOTHING_SAYING)("is no reason when the message is %p (%s)", (message) => {
    expect(rejectionReason({ payload: undefined, error: { message } })).toBeNull();
  });

  /**
   * Not a shape RTK produces — `miniSerializeError` copies across only the
   * string properties — but the guard on `message` is what would keep a future
   * one off a screen, and a guard nothing exercises is a guard that can be
   * deleted. Cast to the helper's own signature on purpose: the mismatch is the
   * point.
   */
  it("is no reason when `message` is not text", () => {
    const notText = { message: 42 } as unknown as NonNullable<RejectionCarrier["error"]>;

    expect(rejectionReason({ payload: undefined, error: notText })).toBeNull();
  });
});
