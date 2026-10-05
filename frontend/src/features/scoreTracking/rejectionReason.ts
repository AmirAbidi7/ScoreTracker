export interface RejectionCarrier {
  payload?: unknown;
  error?: { message?: string };
}

const isAMessage = (candidate: unknown): candidate is string =>
  typeof candidate === "string" && candidate.trim().length > 0;

const RTK_PLACEHOLDER = "Rejected";

// Payload-first: RTK puts the rejection value in `payload` only for `rejectWithValue`.
export const rejectionReason = (rejected: RejectionCarrier): string | null => {
  if (rejected.payload !== undefined) {
    return isAMessage(rejected.payload) ? rejected.payload : null;
  }
  const { message } = rejected.error ?? {};
  if (!isAMessage(message) || message === RTK_PLACEHOLDER) return null;
  return message;
};
