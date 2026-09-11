import { Tabs } from "expo-router";
import { tabs } from "../../../constants/data";
import { colors } from "../../../constants/theme";
import { clsx } from "clsx";
import { Text } from "react-native";

const Header = () => {};
export default function MainLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
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
