import { clsx } from "clsx";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { colors } from "../../../../constants/theme";
import { useAppDispatch, useAppSelector } from "../../../../store";
import type { Scoreboard } from "../../scoreTracking/domain/Scoreboard";
import { rejectionReason } from "../../scoreTracking/rejectionReason";
import { joinScoreboard, loadScoreboards } from "../../scoreTracking/scoreTrackingThunks";

const SCOREBOARD_ROUTE = "/(main)/(scoreTracking)/scoreTracking";

const BoardRow = ({
  board,
  isOpen,
  isJoining,
  onPress,
}: {
  board: Scoreboard;
  isOpen: boolean;
  isJoining: boolean;
  onPress: () => void;
}) => {
  const players = board.players.length;

  return (
    <Pressable
      onPress={onPress}
      testID={`board-${board.id}`}
      disabled={isJoining}
      accessibilityRole="button"
      accessibilityLabel={`${board.gameName}, ${players} ${players === 1 ? "player" : "players"}, code ${board.code}`}
      accessibilityState={{ selected: isOpen }}
      className={clsx(
        "border bg-black px-4 py-3 flex-row justify-between items-center",
        isOpen ? "border-primary" : "border-secondary",
        isJoining && "opacity-50",
      )}
    >
      <View className="gap-1">
        <Text testID={`board-name-${board.id}`} className="text-white font-sans-medium text-2xl">
          {board.gameName}
        </Text>
        <Text className="text-white font-sans-regular text-lg">
          {players} {players === 1 ? "player" : "players"}
        </Text>
      </View>

      <View className="items-end gap-1">
        {isOpen && (
          <Text testID={`board-open-${board.id}`} className="text-primary font-sans-bold text-lg">
            Open
          </Text>
        )}
        <Text
          testID={`board-code-${board.id}`}
          className={clsx(
            "text-2xl",
            isOpen ? "text-primary font-sans-bold" : "text-white font-sans-medium",
          )}
        >
          {board.code}
        </Text>
      </View>
    </Pressable>
  );
};

export default function LeaderboardPage() {
  const dispatch = useAppDispatch();
  const { boards, boardsStatus, current } = useAppSelector((state) => state.scoreboard);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);

  const currentId = current?.id ?? null;

  const load = useCallback(async (): Promise<void> => {
    setLoadError(null);
    setJoinError(null);
    try {
      const result = await dispatch(loadScoreboards());
      if (loadScoreboards.rejected.match(result)) {
        setLoadError(rejectionReason(result) ?? "Couldn't load games");
      }
    } catch {
      setLoadError("Couldn't load games");
    }
  }, [dispatch]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const onSelect = async (code: string): Promise<void> => {
    if (joining !== null) return;

    setJoinError(null);
    setJoining(code);
    try {
      const result = await dispatch(joinScoreboard(code));
      if (joinScoreboard.rejected.match(result)) {
        setJoinError(rejectionReason(result) ?? "Couldn't join that game");
      } else {
        router.replace(SCOREBOARD_ROUTE);
      }
    } catch {
      setJoinError("Couldn't join that game");
    } finally {
      setJoining(null);
    }
  };

  if (boardsStatus === "loading" || boardsStatus === "idle") {
    return (
      <View className="flex-1 bg-black items-center justify-center gap-4" testID="boards-loading">
        <ActivityIndicator color={colors.primary} size="large" />
        <Text className="text-white font-sans-regular text-lg">Loading games...</Text>
      </View>
    );
  }

  return (
    <ScrollView className="bg-black flex-1" contentContainerClassName="gap-4 p-8 pb-24">
      <View className="flex-row items-center justify-between">
        <Text className="text-white font-sans-bold text-2xl">All games</Text>
        <Pressable
          onPress={() => {
            void load();
          }}
          testID="boards-refresh"
          accessibilityRole="button"
          accessibilityLabel="Reload the list of games"
          className="border border-primary px-3 py-1"
        >
          <Text className="text-white font-sans-medium text-lg">Refresh</Text>
        </Pressable>
      </View>

      {boardsStatus === "error" && (
        <View className="border border-red-500 p-4">
          <Text testID="boards-error" className="text-red-500 font-sans-bold text-lg">
            {loadError ?? "Couldn't load games"}
          </Text>
        </View>
      )}

      {joinError !== null && (
        <Text testID="join-error" className="text-red-500 font-sans-medium text-lg">
          {joinError}
        </Text>
      )}

      {boardsStatus === "ready" && boards.length === 0 && (
        <Text testID="boards-empty" className="text-white font-sans-regular text-lg">
          No games yet. Create one from the Join tab.
        </Text>
      )}

      {boards.map((board) => (
        <BoardRow
          key={board.id}
          board={board}
          isOpen={board.id === currentId}
          isJoining={joining !== null}
          onPress={() => {
            void onSelect(board.code);
          }}
        />
      ))}
    </ScrollView>
  );
}
