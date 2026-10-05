import { router } from "expo-router";
import { Pressable, Text, View } from "react-native";

const JOIN_ROUTE = "/(main)/(scoreTracking)/syncGame";

export const AuthUnavailable = () => (
  <View className="bg-background flex-1 gap-6 p-8 pt-24">
    <Text testID="auth-unavailable" className="text-white font-sans-bold text-2xl">
      Sign-in is unavailable
    </Text>
    <Text className="text-white font-sans-regular text-lg">
      This build has no sign-in key, so boards stay watch-only. Add
      EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to sign in and keep score.
    </Text>
    <Pressable
      testID="auth-unavailable-back"
      onPress={() => router.replace(JOIN_ROUTE)}
      className="border border-primary bg-black px-6 py-3"
    >
      <Text className="text-white font-sans-medium text-lg text-center">Back to boards</Text>
    </Pressable>
  </View>
);
