import { clsx } from "clsx";
import { Plus, Trash } from "lucide-react-native";
import { router } from "expo-router";
import { useMemo, useState } from "react";
import { Alert, Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { colors } from "../../../../constants/theme";
import { useAppDispatch, useAppSelector } from "../../../../store";
import { useSafeAuth } from "../../auth/safeAuth";
import BoardQrCode from "../boardQrCode";
import type { Player } from "../domain/Scoreboard";
import {
  claimCurrentScoreboard,
  deleteCurrentScoreboard,
  leaveScoreboard,
  sendIntent,
} from "../scoreTrackingThunks";

const JOIN_ROUTE = "/(main)/(scoreTracking)/syncGame";
const SIGN_IN_ROUTE = "/(auth)/sign-in";

export const AddPlayerModal = ({
  active,
  onClose,
  readOnly,
}: {
  active: boolean;
  onClose: () => void;
  readOnly: boolean;
}) => {
  const [playerName, setPlayerName] = useState("");
  const dispatch = useAppDispatch();

  const submit = () => {
    if (readOnly) return;
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
            <Pressable
              onPress={submit}
              testID="add-player-button"
              disabled={readOnly}
              accessibilityState={{ disabled: readOnly }}
              className={clsx(readOnly && "opacity-50")}
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

const PlayerCard = ({
  player,
  ranking,
  readOnly,
}: {
  player: Player;
  ranking: number;
  readOnly: boolean;
}) => {
  const [amount, setAmount] = useState("1");
  const dispatch = useAppDispatch();

  const parsed = Number(amount);
  const delta = Number.isFinite(parsed) ? parsed : 0;
  const adjustable = delta !== 0 && !readOnly;

  const adjust = (direction: 1 | -1) => {
    if (!adjustable) return;
    const change = delta * direction;
    void dispatch(sendIntent({ type: "addScore", playerId: player.id, amount: change }));
  };

  const remove = () => {
    if (readOnly) return;
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
  const { isSignedIn, userId } = useSafeAuth();
  const { current, status, pendingIntents, error } = useAppSelector((state) => state.scoreboard);
  const [modalOpen, setModalOpen] = useState(false);

  const ownerless = (current?.ownerId ?? null) === null;
  const isOwner = isSignedIn && !ownerless && current?.ownerId === userId;
  const canEdit = isSignedIn && !ownerless;

  const rankings = useMemo(() => {
    if (!current) return [];
    const byScore = new Map<number, number>();
    [...current.players]
      .sort((a, b) => b.score - a.score)
      .forEach((player, index) => byScore.set(player.id, index + 1));
    return current.players.map((player) => byScore.get(player.id) ?? 0);
  }, [current]);

  const onClaim = () => {
    void dispatch(claimCurrentScoreboard());
  };

  const onDelete = () => {
    if (!isOwner) return;
    Alert.alert("Delete game?", `${current?.gameName} and its scores will be gone for everyone.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => void dispatch(deleteCurrentScoreboard()),
      },
    ]);
  };

  const confirmLeave = async () => {
    const result = await dispatch(leaveScoreboard());
    if (leaveScoreboard.rejected.match(result)) return;
    router.replace(JOIN_ROUTE);
  };

  const onLeave = () => {
    Alert.alert(
      "Leave game?",
      `You will stop following ${current?.gameName}. The game stays on the leaderboard and anyone can rejoin with the code ${current?.code}.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Leave", style: "destructive", onPress: () => void confirmLeave() },
      ],
    );
  };

  if (!current) {
    return (
      <View className="bg-black flex-1 items-center justify-center gap-4 px-8" testID="empty-state">
        <Text className="text-white font-sans-bold text-2xl text-center">No game yet</Text>
        <Text className="text-white font-sans-regular text-lg text-center">
          {error ?? "Enter a code on the Join tab, or start a new game."}
        </Text>
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

      <View className="mx-8 flex-row items-center">
        <Pressable
          onPress={onLeave}
          testID="leave-game"
          accessibilityRole="button"
          accessibilityLabel={`Leave ${current.gameName}`}
          accessibilityHint="Asks before you leave. The game stays on the leaderboard"
          className="border border-secondary px-4 py-2"
        >
          <Text className="text-secondary font-sans-medium text-lg">Leave</Text>
        </Pressable>
      </View>

      <View className="mx-8">
        <BoardQrCode code={current.code} />
      </View>

      {!isSignedIn && (
        <Pressable
          testID="sign-in-prompt"
          onPress={() => router.push(SIGN_IN_ROUTE)}
          className="mx-8 border border-tertiary px-4 py-2"
        >
          <Text className="text-tertiary font-sans-medium text-lg text-center">
            Sign in to keep score
          </Text>
        </Pressable>
      )}

      {isSignedIn && ownerless && (
        <Pressable
          testID="claim-board"
          onPress={onClaim}
          className="mx-8 border border-primary px-4 py-2"
        >
          <Text className="text-primary font-sans-medium text-lg text-center">
            Claim this board
          </Text>
        </Pressable>
      )}

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
          <PlayerCard key={player.id} ranking={rankings[index]} player={player} readOnly={!canEdit} />
        ))}
      </ScrollView>

      <AddPlayerModal active={modalOpen} onClose={() => setModalOpen(false)} readOnly={!canEdit} />

      <Pressable
        onPress={() => setModalOpen(true)}
        disabled={!canEdit}
        accessibilityState={{ disabled: !canEdit }}
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
