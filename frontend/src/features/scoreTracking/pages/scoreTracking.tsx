import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { scores as sc } from "../../../../constants/data";
import { Player } from "../domain/Scoreboard";
import { Plus, Trash } from "lucide-react-native";
import { colors } from "../../../../constants/theme";

const AddPlayerModal = ({
  active,
  toggleActive,
  addPlayer,
}: {
  active: boolean;
  toggleActive: () => void;
  addPlayer: (playerName: string) => void;
}) => {
  const [playerName, setPlayerName] = useState("");

  return (
    <Modal
      visible={active}
      onRequestClose={() => toggleActive()}
      transparent={true}
      className=" flex justify-center items-center m-12"
    >
      <View className="flex-1 justify-center items-center">
        <View className="border-tertiary border flex gap-4 justify-center items-start bg-black p-4 mx-12">
          <Text className="text-center text-white font-sans-semiBold text-xl">
            Enter the user's name!
          </Text>
          <TextInput
            value={playerName}
            onChangeText={setPlayerName}
            placeholder="Bryan"
            placeholderTextColor={colors.grey}
            className="border border-white font-sans-regular  w-48 text-white"
          />
          <View className="flex flex-row gap-4 justify-between">
            <Pressable onPress={() => toggleActive()}>
              <View className="bg-black border border-primary p-2">
                <Text className="text-white font-sans-regular text-md">Cancel</Text>
              </View>
            </Pressable>

            <Pressable onPress={() => addPlayer(playerName)}>
              <View className="bg-black border border-primary p-2">
                <Text className="text-white font-sans-regular text-md">Add!</Text>
              </View>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};
const PlayerCard = ({
  player,
  updateScore,
  ranking,
  deletePlayer,
}: {
  player: Player;
  updateScore: (playerId: number, amount: number) => void;
  ranking: number;
  deletePlayer: (playerId: number) => void;
}) => {
  const [amount, setAmount] = useState("1");
  return (
    <View className="mx-8 border border-secondary flex items-stretch px-4 bg-black relative p-2">
      <Pressable onPress={() => deletePlayer(player.id)}>
        <View className="absolute top-0 right-0 m-2">
          <Trash className="" color={colors.white} />
        </View>
      </Pressable>
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
  const [active, setActive] = useState(false);
  const rankings = useMemo(sortPlayerRankings, [scores]);

  function updateScore(playerId: number, amount: number) {
    setScores((currentScores) => ({
      ...currentScores,
      players: currentScores.players.map((player) =>
        player.id == playerId ? { ...player, score: player.score + amount } : player,
      ),
    }));
  }

  function deletePlayer(playerId: number) {
    setScores((currentScores) => ({
      ...currentScores,
      players: currentScores.players.filter((pl) => pl.id !== playerId),
    }));
  }

  function addPlayer(playerName: string) {
    setScores((currentScores) => {
      const lastPlayer = currentScores.players[currentScores.players.length - 1];

      return {
        ...currentScores,
        players: [
          ...currentScores.players,
          {
            id: lastPlayer ? lastPlayer.id + 1 : 1,
            name: playerName,
            score: 0,
          },
        ],
      };
    });
    setActive(!active);
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
    <View className="bg-black flex-1 pt-12 gap-8 relative">
      <View className="mx-8 px-4 border border-primary bg-black flex justify-between items-center flex-row">
        <Text className="text-white font-sans-medium text-2xl">Game: </Text>
        <Text className="text-white font-sans-medium text-2xl">{scores.gameName}</Text>
      </View>
      <ScrollView contentContainerClassName="flex gap-8 pb-16">
        {scores.players.map((currentPlayer, index) => (
          <PlayerCard
            key={currentPlayer.id}
            ranking={rankings[index]}
            player={currentPlayer}
            updateScore={updateScore}
            deletePlayer={deletePlayer}
          ></PlayerCard>
        ))}
      </ScrollView>
      <AddPlayerModal
        active={active}
        toggleActive={() => setActive(!active)}
        addPlayer={addPlayer}
      ></AddPlayerModal>
      <Pressable onPress={() => setActive(!active)} className="absolute bottom-0 right-0">
        <View className="border border-primary m-4 p-4 bg-black">
          <Plus color={colors.white} />
        </View>
      </Pressable>
    </View>
  );
}
