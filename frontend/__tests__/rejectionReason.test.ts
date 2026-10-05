/// <reference types="jest" />
import {
  rejectionReason,
  type RejectionCarrier,
} from "../src/features/scoreTracking/rejectionReason";

describe("a reason in the payload", () => {
  it("is the thunk's own sentence", () => {
    expect(rejectionReason({ payload: "No scoreboard with that code" })).toBe(
      "No scoreboard with that code",
    );
  });

  it("wins over the placeholder RTK leaves in `error`", () => {
    expect(
      rejectionReason({ payload: "Bad gateway", error: { message: "Rejected" } }),
    ).toBe("Bad gateway");
  });

  it.each([["", "empty"], ["   ", "whitespace only"]])(
    "is no reason when it is %p (%s), and does not fall through to `error`",
    (payload) => {
      expect(rejectionReason({ payload, error: { message: "Rejected" } })).toBeNull();
    },
  );

  it("is no reason when the payload is something other than a message", () => {
    expect(rejectionReason({ payload: { code: 500 } })).toBeNull();
  });
});

describe("a reason in a serialised error", () => {
  it("is the thrown error's message", () => {
    expect(rejectionReason({ payload: undefined, error: { message: "Bad gateway" } })).toBe(
      "Bad gateway",
    );
  });

  it("is read when there is no `error` key at all", () => {
    expect(rejectionReason({})).toBeNull();
    expect(rejectionReason({ payload: undefined })).toBeNull();
  });

  it("is not the placeholder RTK substitutes for a reason nobody gave", () => {
    expect(rejectionReason({ payload: undefined, error: { message: "Rejected" } })).toBeNull();
  });

  const NOTHING_SAYING: Array<[string | undefined, string]> = [
    ["", "empty"],
    ["  ", "whitespace only"],
    [undefined, "absent"],
  ];

  it.each(NOTHING_SAYING)("is no reason when the message is %p (%s)", (message) => {
    expect(rejectionReason({ payload: undefined, error: { message } })).toBeNull();
  });

  it("is no reason when `message` is not text", () => {
    const notText = { message: 42 } as unknown as NonNullable<RejectionCarrier["error"]>;

    expect(rejectionReason({ payload: undefined, error: notText })).toBeNull();
  });
});
