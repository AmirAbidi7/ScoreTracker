import { useState } from "react";
import { View, Text } from "react-native";
import { scores as sc } from "../../../../constants/data";
import { Player } from "../domain/Scoreboard";

const PlayerCard = ({ player }: { player: Player }) => {
  return (
    <View className="mx-8 border border-secondary flex justify-center items-center px-4 bg-black">
      <View className="flex justify-between items-center flex-row">
        <Text className="text-white font-sans-medium text-2xl">Player:</Text>
        <Text className="text-white font-sans-medium text-2xl">{player.name}</Text>
      </View>
      <View className="flex justify-between items-center flex-row">
        <Text className="text-white font-sans-medium text-2xl">Score:</Text>
        <Text className="text-white font-sans-medium text-2xl">{player.score}</Text>
      </View>
    </View>
  );
};

export default function ScoreTrackingPage() {
  const [scores, setScores] = useState(sc);

  return (
    <View className="bg-background flex-1 pt-12 gap-8">
      <View className="mx-8 px-4 border border-primary bg-black flex justify-between items-center flex-row">
        <Text className="text-white font-sans-medium text-2xl">Game: </Text>
        <Text className="text-white font-sans-medium text-2xl">{scores.gameName}</Text>
      </View>
      {scores.players.map((currentPlayer) => (
        <PlayerCard player={currentPlayer}></PlayerCard>
      ))}
    </View>
  );
}
