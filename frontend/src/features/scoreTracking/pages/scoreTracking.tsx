import { useMemo, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { scores as sc } from "../../../../constants/data";
import { Player } from "../domain/Scoreboard";

const PlayerCard = ({
  player,
  updateScore,
  ranking,
}: {
  player: Player;
  updateScore: (playerId: number, amount: number) => void;
  ranking: number;
}) => {
  const [amount, setAmount] = useState("1");
  return (
    <View className="mx-8 border border-secondary flex items-stretch px-4 bg-black">
      <View className="flex justify-between items-center flex-row">
        <View className="flex justify-center items-center flex-row gap-4">
          <Text className="text-white font-sans-medium text-2xl">{ranking}.</Text>
          <Text className="text-white font-sans-medium text-2xl">{player.name}</Text>
        </View>
      </View>
      <View className="flex justify-between items-center flex-row gap-4">
        <View className="flex flex-row gap-2">
          <Text className="text-white font-sans-medium text-2xl">Score:</Text>
          <Text className="text-white font-sans-medium text-2xl">{player.score}</Text>
        </View>
        <View className="flex flex-row gap-4 justify-between items-center">
          <Pressable
            onPress={() => updateScore(player.id, Number(amount))}
            className="border border-white px-4"
          >
            <Text className="text-white font-sans-regular text-md">+</Text>
          </Pressable>
          <TextInput
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            className="text-white font-sans-regular"
          />
          <Pressable
            onPress={() => updateScore(player.id, -Number(amount))}
            className="border border-white px-4"
          >
            <Text className="text-white font-sans-regular text-md">-</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

export default function ScoreTrackingPage() {
  const [scores, setScores] = useState(sc);
  const rankings = useMemo(sortPlayerRankings, [scores]);

  function updateScore(playerId: number, amount: number) {
    setScores((currentScores) => ({
      ...currentScores,
      players: currentScores.players.map((player) =>
        player.id == playerId ? { ...player, score: player.score + amount } : player,
      ),
    }));
  }

  function sortPlayerRankings() {
    const sortedScores = [...scores.players].sort(
      (player1, player2) => player2.score - player1.score,
    );
    const rankings: number[] = [];
    scores.players.forEach((player) => {
      const index = sortedScores.findIndex((playa) => player.id === playa.id);
      rankings.push(index + 1);
    });

    return rankings;
  }

  return (
    <View className="bg-black flex-1 pt-12 gap-8">
      <View className="mx-8 px-4 border border-primary bg-black flex justify-between items-center flex-row">
        <Text className="text-white font-sans-medium text-2xl">Game: </Text>
        <Text className="text-white font-sans-medium text-2xl">{scores.gameName}</Text>
      </View>
      {scores.players.map((currentPlayer, index) => (
        <PlayerCard
          key={currentPlayer.id}
          ranking={rankings[index]}
          player={currentPlayer}
          updateScore={updateScore}
        ></PlayerCard>
      ))}
    </View>
  );
}
