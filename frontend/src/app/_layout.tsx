import "@/global.css";
import { useFonts } from "expo-font";
import { SplashScreen, Stack } from "expo-router";
import { StrictMode, useEffect } from "react";
import { Provider } from "react-redux";
import { store } from "../../store";

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
  return (
    <StrictMode>
      <Provider store={store}>
        <Stack screenOptions={{ headerShown: false }} />
      </Provider>
    </StrictMode>
  );
}
