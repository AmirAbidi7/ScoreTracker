import Logo from "@/assets/vectors/logo.svg";
import { useScoreboardSync } from "@/features/scoreTracking/useScoreboardSync";
import { clsx } from "clsx";
import { Tabs } from "expo-router";
import { Text, View } from "react-native";
import { tabs } from "../../../constants/data";
import { colors } from "../../../constants/theme";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

const Header = () => {
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{ paddingTop: insets.top }}
      className="flex flex-row justify-between bg-background w-full px-2 items-center"
    >
      <Logo width={52} height={52} />
      <View className="px-2 bg-green-500/20 rounded-2xl items-center justify-center my-2">
        <Text className="text-emerald-500 text-center font-sans-regular">LIVE! ●</Text>
      </View>
    </View>
  );
};

export default function MainLayout() {
  useScoreboardSync();

  return (
    <>
      <StatusBar style="light" />
      <Tabs
        screenOptions={{
          headerShown: true,
          header: () => <Header />,
          tabBarStyle: {
            backgroundColor: colors.background,
            marginBottom: 20,
          },
        }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <Tabs.Screen
              name={tab.name}
              key={tab.name}
              options={{
                title: tab.title,
                tabBarIcon: ({ focused }) => (
                  <Icon
                    height={24}
                    width={24}
                    fill={focused ? colors.primary : "transparent"}
                    color={colors.primary}
                  ></Icon>
                ),
                tabBarLabel: ({ focused }) => (
                  <Text
                    className={clsx("font-sans-regular text-primary", focused && "font-sans-bold")}
                  >
                    {tab.title}
                  </Text>
                ),
              }}
            />
          );
        })}
      </Tabs>
    </>
  );
}
