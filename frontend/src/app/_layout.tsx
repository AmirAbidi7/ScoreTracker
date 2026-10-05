import { ClerkProvider } from "@clerk/expo";
import "@/global.css";
import { useFonts } from "expo-font";
import { SplashScreen, Stack } from "expo-router";
import { StrictMode, useEffect } from "react";
import { Provider } from "react-redux";
import { tokenCache } from "../../infrastructure/auth/tokenCache";
import { store } from "../../store";

// Expo inlines `process.env` only for static dot-notation access; bracket/destructured forms silently resolve to `undefined`.
const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

const MissingKeyNotice = (): null => {
  useEffect(() => {
    console.warn(
      "[auth] EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY is missing; running signed-out view-only.",
    );
  }, []);
  return null;
};

export default function RootLayout() {
  const [loaded, error] = useFonts({
    "pixel-title": require("@/assets/fonts/PressStart2P-Regular.ttf"),
    "pixel-bold": require("@/assets/fonts/PixelifySans-Bold.ttf"),
    "pixel-medium": require("@/assets/fonts/PixelifySans-Medium.ttf"),
    "pixel-regular": require("@/assets/fonts/PixelifySans-Regular.ttf"),
    "pixel-semibold": require("@/assets/fonts/PixelifySans-SemiBold.ttf"),
  });

  useEffect(() => {
    if (loaded || error) {
      SplashScreen.hideAsync();
    }
  }, [loaded, error]);
  if (!loaded && error) {
    return null;
  }

  const tree = (
    <Provider store={store}>
      <Stack screenOptions={{ headerShown: false }} />
    </Provider>
  );

  if (!publishableKey) {
    return (
      <StrictMode>
        <MissingKeyNotice />
        {tree}
      </StrictMode>
    );
  }

  return (
    <StrictMode>
      <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
        {tree}
      </ClerkProvider>
    </StrictMode>
  );
}
