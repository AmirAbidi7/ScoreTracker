import "@/global.css";
import { SplashScreen, Stack } from "expo-router";
import { useFonts } from "expo-font";
import { useEffect } from "react";

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
  return <Stack screenOptions={{ headerShown: false }} />;
}
