import { View, Text, Image, Pressable } from "react-native";
import onboarding from "../../../../constants/images";
import { Link } from "expo-router";

export default function OnboardingPage() {
  return (
    <View className="flex-1">
      <Image
        source={onboarding}
        className="absolute top-0 w-full aspect-[1]"
        resizeMode="cover"
      ></Image>
      <View className="bg-black opacity-20 w-full h-full absolute top-0 left-0" />
      <View className="flex-1 gap-8 p-12 items-center justify-center">
        <Text className="text-white text-2xl font-sans-extrabold text-center">
          Never ask your friend for the score ever again
        </Text>
        <Text className="font-sans-regular text-xl text-md text-white text-center">
          Scan the QR code or enter the code, have the scoreboard available to you directly and in
          real time
        </Text>
        <Link
          className="bg-background border border-primary text-white p-2 font-sans-medium"
          href="/(scoreTracking)/scoreTracking"
        >
          Get Started!
        </Link>
      </View>
    </View>
  );
}
