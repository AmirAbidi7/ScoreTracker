import { clsx } from "clsx";
import { Plus, Trash } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { colors } from "../../../../constants/theme";
import { useAppDispatch, useAppSelector } from "../../../../store";
import type { Player } from "../domain/Scoreboard";
import {
  deleteCurrentScoreboard,
  leaveScoreboard,
  sendIntent,
} from "../scoreTrackingThunks";

const AddPlayerModal = ({
  active,
  onClose,
}: {
  active: boolean;
  onClose: () => void;
}) => {
  const [playerName, setPlayerName] = useState("");
  const dispatch = useAppDispatch();

  const submit = () => {
    const name = playerName.trim();
    if (name.length === 0) return;
    void dispatch(sendIntent({ type: "addPlayer", name }));
    setPlayerName("");
    onClose();
  };

  return (
    <Modal visible={active} onRequestClose={onClose} transparent>
      <View className="flex-1 justify-center items-center">
        <View className="border-tertiary border gap-4 justify-center items-start bg-black p-4 mx-12">
          <Text className="text-center text-white font-sans-semiBold text-xl">
            Enter the player's name
          </Text>
          <TextInput
            testID="player-name-input"
            value={playerName}
            onChangeText={setPlayerName}
            placeholder="Bryan"
            placeholderTextColor={colors.grey}
            className="border border-white font-sans-regular w-48 text-white"
          />
          <View className="flex flex-row gap-4 justify-between">
            <Pressable onPress={onClose} testID="cancel-add-player">
              <View className="bg-black border border-primary p-2">
                <Text className="text-white font-sans-regular text-md">Cancel</Text>
              </View>
            </Pressable>
            <Pressable onPress={submit} testID="add-player-button">
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
  const dispatch = useAppDispatch();

  // `Number` is forgiving in a way that is not useful here: `Number("")` and
  // `Number("  ")` are both 0, and `Number("abc")` is `NaN`. All three collapse
  // to a delta of 0, which the server would accept as a real `addScore` intent
  // and apply as a no-op write — a pointless request and broadcast, and a
  // "Saving 1 change…" flash for something the user did not change. So the
  // buttons are disabled outright unless the box holds a usable non-zero number:
  // `keyboardType="numeric"` is a hint to the keyboard, not validation, so a
  // pasted "abc" or a grouped "1,000" lands here too. A dimmed, disabled button
  // says so, where a button that silently swallows the press is
  // indistinguishable from a dropped tap.
  const parsed = Number(amount);
  const delta = Number.isFinite(parsed) ? parsed : 0;
  const adjustable = delta !== 0;

  /**
   * The server decides the score, so this only ever states the change that was
   * asked for. `void` on the dispatch because a handler that returns a promise
   * leaks it to whoever invoked it, and a press should not be a thing anyone
   * can be made to wait on.
   */
  const adjust = (direction: 1 | -1) => {
    if (!adjustable) return;
    const change = delta * direction;
    void dispatch(sendIntent({ type: "addScore", playerId: player.id, amount: change }));
  };

  /**
   * A long press, not a tap, for the same reason deleting the game is one: this
   * drops a player for everyone in the room and there is no undo. `onPress` is
   * deliberately absent, so a tap does nothing at all — an accidental brush
   * across the card cannot cost somebody their place in the game.
   */
  const remove = () => {
    void dispatch(sendIntent({ type: "removePlayer", playerId: player.id }));
  };

  return (
    <View className="mx-8 border border-secondary flex items-stretch px-4 bg-black relative p-2">
      <Pressable
        onLongPress={remove}
        delayLongPress={600}
        accessibilityHint={`Long press to remove ${player.name} from the game for everyone`}
        testID={`remove-player-${player.id}`}
      >
        <View className="absolute top-0 right-0 m-2">
          <Trash color={colors.white} />
        </View>
      </Pressable>
      <View className="flex justify-between items-center flex-row">
        <View className="flex justify-center items-center flex-row gap-4">
          <Text
            className="text-white font-sans-medium text-2xl"
            testID={`player-rank-${player.id}`}
          >
            {ranking}.
          </Text>
          <Text
            className="text-white font-sans-medium text-2xl"
            testID={`player-name-${player.id}`}
          >
            {player.name}
          </Text>
        </View>
      </View>
      <View className="flex justify-between items-center flex-row gap-4">
        <View className="flex flex-row gap-2">
          <Text className="text-white font-sans-medium text-2xl">Score:</Text>
          <Text
            className="text-white font-sans-medium text-2xl"
            testID={`player-score-${player.id}`}
          >
            {player.score}
          </Text>
        </View>
        <View className="flex flex-row gap-4 justify-between items-center">
          <Pressable
            onPress={() => adjust(1)}
            disabled={!adjustable}
            accessibilityState={{ disabled: !adjustable }}
            className={clsx("border border-white px-4", !adjustable && "opacity-50")}
            testID={`add-score-${player.id}`}
          >
            <Text className="text-white font-sans-regular text-md">+</Text>
          </Pressable>
          <TextInput
            testID={`amount-${player.id}`}
            value={amount}
            onChangeText={setAmount}
            keyboardType="numeric"
            className="text-white font-sans-regular"
          />
          <Pressable
            onPress={() => adjust(-1)}
            disabled={!adjustable}
            accessibilityState={{ disabled: !adjustable }}
            className={clsx("border border-white px-4", !adjustable && "opacity-50")}
            testID={`subtract-score-${player.id}`}
          >
            <Text className="text-white font-sans-regular text-md">-</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
};

export default function ScoreTrackingPage() {
  const dispatch = useAppDispatch();
  const { current, status, pendingIntents, error } = useAppSelector((state) => state.scoreboard);
  const [modalOpen, setModalOpen] = useState(false);

  const rankings = useMemo(() => {
    if (!current) return [];
    const byScore = new Map<number, number>();
    [...current.players]
      .sort((a, b) => b.score - a.score)
      .forEach((player, index) => byScore.set(player.id, index + 1));
    return current.players.map((player) => byScore.get(player.id) ?? 0);
  }, [current]);

  const onDelete = () => {
    Alert.alert("Delete game?", `${current?.gameName} and its scores will be gone for everyone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void dispatch(deleteCurrentScoreboard()),
      },
    ]);
  };

  if (!current) {
    return (
      <View className="bg-black flex-1 items-center justify-center gap-4 px-8" testID="empty-state">
        <Text className="text-white font-sans-bold text-2xl text-center">No game yet</Text>
        <Text className="text-white font-sans-regular text-lg text-center">
          {error ?? "Enter a code on the Join tab, or start a new game."}
        </Text>
        {/*
          * "Dismiss", not "Retry": with `current === null` there is nothing to
          * retry. No board means no code, and the saved session that would have
          * carried one was either never written or has already been cleared.
          * What this does is put the error away — `leaveScoreboard` resets the
          * store, which nulls `error` and drops any stale session pointer — so
          * a label promising a second attempt is a label that lies.
          */}
        <Pressable
          onPress={() => void dispatch(leaveScoreboard())}
          className="border border-primary px-6 py-3"
          testID="empty-state-dismiss"
        >
          <Text className="text-white font-sans-medium text-lg">Dismiss</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="bg-black flex-1 pt-12 gap-8 relative">
      <Pressable
        onLongPress={onDelete}
        delayLongPress={600}
        testID="game-header"
        className="mx-8 px-4 border border-primary bg-black flex justify-between items-center flex-row"
      >
        <Text className="text-white font-sans-medium text-2xl">Game: </Text>
        <View className="flex-row items-center gap-3">
          <Text className="text-white font-sans-medium text-2xl">{current.gameName}</Text>
          <Text className="text-primary font-sans-bold text-md">{current.code}</Text>
        </View>
      </Pressable>

      {(status === "connecting" || status === "reconnecting" || status === "offline") && (
        <Text testID="connection-banner" className="mx-8 text-yellow-500 font-sans-medium text-md">
          {status === "offline" ? "Offline" : "Reconnecting"}...
        </Text>
      )}

      {pendingIntents > 0 && (
        <Text testID="pending-banner" className="mx-8 text-white font-sans-regular text-md">
          Saving {pendingIntents} {pendingIntents === 1 ? "change" : "changes"}...
        </Text>
      )}

      {error !== null && (
        <Text testID="scoreboard-error" className="mx-8 text-red-500 font-sans-medium text-md">
          {error}
        </Text>
      )}

      <ScrollView contentContainerClassName="flex gap-8 pb-16">
        {current.players.length === 0 && (
          <Text
            className="text-white font-sans-regular text-xl mx-8 mt-8"
            testID="no-players"
          >
            Add the players to start scoring.
          </Text>
        )}

        {current.players.map((player, index) => (
          <PlayerCard key={player.id} ranking={rankings[index]} player={player} />
        ))}
      </ScrollView>

      <AddPlayerModal active={modalOpen} onClose={() => setModalOpen(false)} />

      <Pressable
        onPress={() => setModalOpen(true)}
        className="absolute bottom-0 right-0"
        testID="add-player-fab"
      >
        <View className="border border-primary m-4 p-4 bg-black">
          <Plus color={colors.white} />
        </View>
      </Pressable>
    </View>
  );
}
