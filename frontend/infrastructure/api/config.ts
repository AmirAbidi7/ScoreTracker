import { Platform } from "react-native";

// Expo inlines `process.env` only for static dot-notation access; bracket/destructured forms silently resolve to `undefined`.
const configured = process.env.EXPO_PUBLIC_API_URL;

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1"];

export const API_BASE_URL = (configured?.trim() || "http://localhost:3000").replace(/\/+$/, "");

export const SOCKET_URL = API_BASE_URL;

const host = (() => {
  try {
    return new URL(API_BASE_URL).hostname || null;
  } catch {
    return null;
  }
})();

if (__DEV__ && process.env.NODE_ENV !== "test" && Platform.OS !== "web") {
  if (host === null) {
    console.warn(
      `[config] EXPO_PUBLIC_API_URL is "${API_BASE_URL}", which has no parseable host. ` +
        `It must be an absolute URL including the scheme, e.g. set ` +
        `EXPO_PUBLIC_API_URL=http://192.168.1.42:3000 in .env.local.`,
    );
  } else if (LOOPBACK_HOSTS.includes(host)) {
    console.warn(
      `[config] EXPO_PUBLIC_API_URL is "${API_BASE_URL}" but you are running on ${Platform.OS}. ` +
        `Use your machine's LAN address (e.g. http://192.168.1.42:3000) in .env.local, ` +
        `or run the app on web.`,
    );
  }
}
