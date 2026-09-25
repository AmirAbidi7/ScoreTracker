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

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

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
      return isFiniteNumber(candidate.playerId) && isFiniteNumber(candidate.amount)
        ? { type: "addScore", playerId: candidate.playerId, amount: candidate.amount }
        : null;
    case "addPlayer":
      return isNonEmptyString(candidate.name) ? { type: "addPlayer", name: candidate.name } : null;
    case "removePlayer":
      return isFiniteNumber(candidate.playerId)
        ? { type: "removePlayer", playerId: candidate.playerId }
        : null;
    default:
      return null;
  }
};
