import Logo from "@/assets/vectors/logo.svg";
import { clsx } from "clsx";
import { Tabs } from "expo-router";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { tabs } from "../../../constants/data";
import { colors } from "../../../constants/theme";

const Header = () => {
  return (
    <View className="flex flex-row justify-between bg-background w-full px-2">
      <Logo width={52} height={52} />
      <View className="px-2 bg-green-500/20 rounded-2xl items-center justify-center my-3">
        <Text className="text-emerald-500 text-center">LIVE! ●</Text>
      </View>
    </View>
  );
};
export default function MainLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: true,
        header: () => (
          <SafeAreaView className="flex-1">
            <Header />,
          </SafeAreaView>
        ),
        tabBarStyle: {
          backgroundColor: colors.background,
          marginVertical: 20,
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
  );
}
