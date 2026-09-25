import { Platform } from "react-native";

// Expo inlines `process.env.X` only when X is a static dot-notation property
// access. `process.env[name]` and `const { X } = process.env` are silently
// left as-is and resolve to undefined in the bundle. Do not "refactor" this.
const configured = process.env.EXPO_PUBLIC_API_URL;

// No "::1" entry: the loopback check below only runs on iOS/Android, where
// `URL` is React Native's own shim (setUpXHR.js polyfills it from
// Libraries/Blob/URL.js). That shim's regex stops at the first ":", so an IPv6
// literal yields "[" and could never equal "::1". An entry that looks live but
// is not is worse than no entry. Restore it if RN ships a compliant `URL`.
const LOOPBACK_HOSTS = ["localhost", "127.0.0.1"];

/**
 * Normalised base URL with no trailing slash, so callers can append
 * `/api/scoreboard` without producing a double slash.
 *
 * Falls back on empty and whitespace-only values, not only on an absent one.
 * `??` alone lets `EXPO_PUBLIC_API_URL=` through as `""`, and every call then
 * becomes a relative URL: on web that resolves against the Metro dev server on
 * :8081, so the app posts its scoreboards there and gets router HTML back
 * instead of JSON.
 */
export const API_BASE_URL = (configured?.trim() || "http://localhost:3000").replace(/\/+$/, "");

/** socket.io is served by the same HTTP server as the REST API. */
export const SOCKET_URL = API_BASE_URL;

const host = (() => {
  try {
    // "localhost:3000" parses without throwing but yields an empty hostname,
    // so an empty host is as unusable as an unparseable one.
    return new URL(API_BASE_URL).hostname || null;
  } catch {
    return null;
  }
})();

if (__DEV__ && Platform.OS !== "web") {
  if (host === null) {
    // The more urgent of the two misconfigurations, and the one a set-but-empty
    // variable used to produce silently: `new URL("")` throws, so the old
    // `host !== null` guard swallowed exactly the case worth reporting.
    console.warn(
      `[config] EXPO_PUBLIC_API_URL is "${API_BASE_URL}", which has no parseable host. ` +
        `It must be an absolute URL including the scheme, e.g. set ` +
        `EXPO_PUBLIC_API_URL=http://192.168.1.42:3000 in .env.local.`,
    );
  } else if (LOOPBACK_HOSTS.includes(host)) {
    // On a device, `localhost` resolves to the device itself, so every request
    // fails against a backend that is actually running — and the failure looks
    // like a dead server rather than a misconfigured URL. Say so plainly.
    console.warn(
      `[config] EXPO_PUBLIC_API_URL is "${API_BASE_URL}" but you are running on ${Platform.OS}. ` +
        `Use your machine's LAN address (e.g. http://192.168.1.42:3000) in .env.local, ` +
        `or run the app on web.`,
    );
  }
}
