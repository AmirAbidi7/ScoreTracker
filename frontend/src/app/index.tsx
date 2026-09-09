import { Pressable, Text, View } from "react-native";

export default function Index() {
  return (
    <View className="flex-1 items-center justify-center bg-background">
      <Text className="text-white">Edit src/app/index.tsx to edit this screen.</Text>
      <Pressable className="bg-primary p-4 rounded-md ">
        <Text className="font-sans-regular">Heho!</Text>
      </Pressable>
      <Pressable className="bg-secondary p-4 rounded-md">
        <Text>Heha!</Text>
      </Pressable>
      <Pressable className="bg-tertiary p-4 rounded-md">
        <Text>Hehe!</Text>
      </Pressable>
    </View>
  );
}
