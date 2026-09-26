/**
 * The only thing a client is allowed to say about a scoreboard. A client
 * states *what changed* ("player 2 gained 5"), never the resulting score: the
 * server derives the new board itself in `applyIntent`. That inversion is the
 * security invariant of the whole design, so nothing here carries a score.
 */
export type ScoreboardIntent =
  | { readonly type: "addScore"; readonly playerId: number; readonly amount: number }
  | { readonly type: "addPlayer"; readonly name: string }
  | { readonly type: "removePlayer"; readonly playerId: number };

/**
 * The largest change one intent may carry, in either direction.
 *
 * Scores are ordinary numbers in a real game: a cricket innings is 300, a Monopoly
 * bankroll is thousands, a cricket-bowling side's worst day is a few hundred. A
 * million is three orders of magnitude more than any of them, so nothing a person
 * means to type is refused — and it is four to seven orders of magnitude below the
 * point where arithmetic stops being exact.
 *
 * The bound has to exist rather than merely being tidy. `1e308` is a finite
 * number, so a UI that enables its button on `isFinite` sends it verbatim; two of
 * them make the score `Infinity`, `JSON.stringify` writes that into the jsonb
 * column as `null`, and from that moment every client renders a blank score and
 * the ranking sort `b.score - a.score` is `NaN`. A board is unrecoverable from
 * that by any means short of editing the row, and the client that caused it never
 * sees an error.
 */
const MAX_AMOUNT = 1_000_000;

/**
 * An integer that survives arithmetic.
 *
 * `Number.isInteger` is not enough: it is true of `2.5`'s neighbours in the
 * floating-point sense and of `1e308` is false but `Number.isSafeInteger` is what
 * also rejects anything past `2^53 - 1`, where `+ 1` stops changing the value and
 * a score could quietly go backwards.
 */
const isSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

/** A `playerId` is a row number, so it has to be a whole one to match anything. */
const isPlayerId = (value: unknown): value is number => isSafeInteger(value);

/** See `MAX_AMOUNT`: an integer, and inside the bound. */
const isAmount = (value: unknown): value is number =>
  isSafeInteger(value) && Math.abs(value) <= MAX_AMOUNT;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/**
 * Runtime guard for data arriving off the wire. Intents are untrusted: a
 * malformed payload must be rejected, never crash the socket handler.
 * Returns null rather than throwing so callers can branch on it.
 */
export const parseIntent = (value: unknown): ScoreboardIntent | null => {
  if (typeof value !== "object" || value === null) return null;

  const candidate = value as Record<string, unknown>;

  switch (candidate.type) {
    case "addScore":
      return isPlayerId(candidate.playerId) && isAmount(candidate.amount)
        ? { type: "addScore", playerId: candidate.playerId, amount: candidate.amount }
        : null;
    case "addPlayer":
      return isNonEmptyString(candidate.name) ? { type: "addPlayer", name: candidate.name } : null;
    case "removePlayer":
      return isPlayerId(candidate.playerId)
        ? { type: "removePlayer", playerId: candidate.playerId }
        : null;
    default:
      return null;
  }
};
