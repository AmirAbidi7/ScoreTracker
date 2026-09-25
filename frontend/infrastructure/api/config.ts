import { Platform } from "react-native";

// Expo inlines `process.env.X` only when X is a static dot-notation property
// access. `process.env[name]` and `const { X } = process.env` are silently
// left as-is and resolve to undefined in the bundle. Do not "refactor" this.
const configured = process.env.EXPO_PUBLIC_API_URL;

const LOOPBACK_HOSTS = ["localhost", "127.0.0.1", "::1"];

/**
 * Normalised base URL with no trailing slash, so callers can append
 * `/api/scoreboard` without producing a double slash.
 */
export const API_BASE_URL = (configured ?? "http://localhost:3000").replace(/\/+$/, "");

/** socket.io is served by the same HTTP server as the REST API. */
export const SOCKET_URL = API_BASE_URL;

const host = (() => {
  try {
    return new URL(API_BASE_URL).hostname;
  } catch {
    return null;
  }
})();

// On a device, `localhost` resolves to the device itself, so every request
// fails against a backend that is actually running — and the failure looks
// like a dead server rather than a misconfigured URL. Say so plainly.
if (__DEV__ && Platform.OS !== "web" && host !== null && LOOPBACK_HOSTS.includes(host)) {
  console.warn(
    `[config] EXPO_PUBLIC_API_URL is "${API_BASE_URL}" but you are running on ${Platform.OS}. ` +
      `Use your machine's LAN address (e.g. http://192.168.1.42:3000) in .env.local, ` +
      `or run the app on web.`,
  );
}
