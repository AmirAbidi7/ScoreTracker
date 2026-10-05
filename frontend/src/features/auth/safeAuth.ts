import { useAuth } from "@clerk/expo";

// Expo inlines `process.env` only for static dot-notation access; bracket/destructured forms silently resolve to `undefined`.
export const isClerkConfigured = (): boolean =>
  Boolean(process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY);

const signedOut = {
  isLoaded: true,
  isSignedIn: false as const,
  userId: null as null,
  getToken: async (): Promise<null> => null,
  signOut: async (): Promise<void> => {},
};

// _layout renders the tree with no ClerkProvider when the key is missing, and
// Clerk hooks throw without a provider, so fall back to signed-out view-only.
export const useSafeAuth = () => {
  try {
    return useAuth();
  } catch {
    return signedOut;
  }
};
