import { Plus, Trash } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useDispatch, useSelector } from "react-redux";
import { colors } from "../../../../constants/theme";
import { RootState } from "../../../../store";
import { Player } from "../domain/Scoreboard";
import { addPlayer, removePlayer, updateScore } from "../scoreTrackingSlice";

const AddPlayerModal = ({
  active,
  toggleActive,
}: {
  active: boolean;
  toggleActive: () => void;
}) => {
  const [playerName, setPlayerName] = useState("");
  const dispatch = useDispatch();

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

            <Pressable
              onPress={() => {
                dispatch(addPlayer(playerName));
                toggleActive();
              }}
            >
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
const PlayerCard = ({ player, ranking }: { player: Player; ranking: number }) => {
  const [amount, setAmount] = useState("1");
  const dispatch = useDispatch();

  return (
    <View className="mx-8 border border-secondary flex items-stretch px-4 bg-black relative p-2">
      <Pressable onPress={() => dispatch(removePlayer(player.id))}>
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
            onPress={() => dispatch(updateScore({ playerId: player.id, amount: Number(amount) }))}
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
            onPress={() => dispatch(updateScore({ playerId: player.id, amount: -Number(amount) }))}
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
  const scoreboard = useSelector((state: RootState) => state.scoreboard.value);
  const [active, setActive] = useState(false);
  const rankings = useMemo(sortPlayerRankings, [scoreboard]);

  function sortPlayerRankings() {
    const sortedScores = [...scoreboard.players].sort(
      (player1, player2) => player2.score - player1.score,
    );
    const rankings: number[] = [];
    scoreboard.players.forEach((player) => {
      const index = sortedScores.findIndex((playa) => player.id === playa.id);
      rankings.push(index + 1);
    });

    return rankings;
  }

  return (
    <View className="bg-black flex-1 pt-12 gap-8 relative">
      <View className="mx-8 px-4 border border-primary bg-black flex justify-between items-center flex-row">
        <Text className="text-white font-sans-medium text-2xl">Game: </Text>
        <Text className="text-white font-sans-medium text-2xl">{scoreboard.gameName}</Text>
      </View>
      <ScrollView contentContainerClassName="flex gap-8 pb-16">
        {scoreboard.players.map((currentPlayer, index) => (
          <PlayerCard
            key={currentPlayer.id}
            ranking={rankings[index]}
            player={currentPlayer}
          ></PlayerCard>
        ))}
      </ScrollView>
      <AddPlayerModal active={active} toggleActive={() => setActive(!active)} />
      <Pressable onPress={() => setActive(!active)} className="absolute bottom-0 right-0">
        <View className="border border-primary m-4 p-4 bg-black">
          <Plus color={colors.white} />
        </View>
      </Pressable>
    </View>
  );
}
