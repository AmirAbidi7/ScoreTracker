import * as SecureStore from "expo-secure-store";
import type { TokenCache } from "@clerk/expo";

const getToken = async (key: string): Promise<string | null> => {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
};

const saveToken = async (key: string, value: string): Promise<void> => {
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
  }
};

export const tokenCache: TokenCache = { getToken, saveToken };
