import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "playboard.session.v1";

export interface SavedSession {
  id: string;
  code: string;
}

const isUsableSession = (value: unknown): value is SavedSession => {
  if (typeof value !== "object" || value === null) return false;

  const { id, code } = value as Record<string, unknown>;
  return (
    typeof id === "string" &&
    id.trim() !== "" &&
    typeof code === "string" &&
    code.trim() !== ""
  );
};

const parseStoredSession = (raw: string): SavedSession | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isUsableSession(parsed)) return null;
  return { id: parsed.id, code: parsed.code };
};

export const readSavedSession = async (): Promise<SavedSession | null> => {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw === null) return null;

    const session = parseStoredSession(raw);
    if (session) return session;

    try {
      await clearSavedSession();
    } catch {
    }

    return null;
  } catch {
    return null;
  }
};

export const writeSavedSession = async (session: SavedSession): Promise<void> => {
  if (!isUsableSession(session)) return;

  await AsyncStorage.setItem(
    KEY,
    JSON.stringify({ id: session.id, code: session.code }),
  );
};

export const clearSavedSession = async (): Promise<void> => {
  await AsyncStorage.removeItem(KEY);
};
