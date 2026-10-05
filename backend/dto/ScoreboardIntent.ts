export type ScoreboardIntent =
  | { readonly type: "addScore"; readonly playerId: number; readonly amount: number }
  | { readonly type: "addPlayer"; readonly name: string }
  | { readonly type: "removePlayer"; readonly playerId: number };

const MAX_AMOUNT = 1_000_000;

const isSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value);

const isPlayerId = (value: unknown): value is number => isSafeInteger(value);

const isAmount = (value: unknown): value is number =>
  isSafeInteger(value) && Math.abs(value) <= MAX_AMOUNT;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

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
