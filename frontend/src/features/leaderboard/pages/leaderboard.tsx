import { clsx } from "clsx";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { colors } from "../../../../constants/theme";
import { useAppDispatch, useAppSelector } from "../../../../store";
import type { Scoreboard } from "../../scoreTracking/domain/Scoreboard";
import { joinScoreboard, loadScoreboards } from "../../scoreTracking/scoreTrackingThunks";

/** The Scoreboard tab, which is where a board that was joined is shown. */
const SCOREBOARD_ROUTE = "/(main)/(scoreTracking)/scoreTracking";

/**
 * The message a rejected thunk is carrying, or `null` when it is carrying
 * nothing worth putting on screen.
 *
 * Both shapes `unwrap()` can reject with are read, because the thunks use both
 * `rejectWithValue` — which throws the reason itself — and could throw, in which
 * case RTK rejects with a serialised error: a plain object carrying a `message`,
 * not an `Error`, so an `instanceof Error` test would miss it. A blank message
 * counts as no message at all: it renders an empty red line, which is the
 * silence this exists to prevent, one layer down.
 */
const reasonOf = (rejected: unknown): string | null => {
  if (typeof rejected === "string") return rejected.trim() === "" ? null : rejected;
  if (typeof rejected === "object" && rejected !== null && "message" in rejected) {
    const { message } = rejected as { message: unknown };
    if (typeof message === "string" && message.trim() !== "") return message;
  }
  return null;
};

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

  /** The id of the board this device is in, or `null` when it is in none. */
  const currentId = current?.id ?? null;

  /**
   * Loads the list, and keeps the reason a load failed.
   *
   * The reason is kept here rather than read from the store because the store's
   * `error` field is not this list's: it belongs to the board that is open, and
   * only a failed intent or a gateway event writes it. `loadScoreboards` puts
   * the status in the store and the reason in the action it returns, so a failed
   * load read from the store alone would answer with a stale board error or
   * nothing at all — the same screen saying nothing about the thing that broke.
   * Nothing here writes board state; `boards` and `boardsStatus` are the store's
   * to change.
   */
  const load = useCallback(async (): Promise<void> => {
    setLoadError(null);
    try {
      await dispatch(loadScoreboards()).unwrap();
    } catch (rejected: unknown) {
      setLoadError(reasonOf(rejected) ?? "Couldn't load games");
    }
  }, [dispatch]);

  /**
   * Fetched on mount and on an explicit retry, and not on every visit.
   *
   * A tab navigator keeps a tab mounted once it has been opened, so a game
   * started on the Join tab after this tab was last loaded does not appear in
   * this list until the tab is remounted. `useFocusEffect` is the primitive
   * the Expo Router v57 docs give for a list that has to be right every time the
   * user comes back to it, and this is where that would go; the reason it is not
   * here is that the focus it depends on is not reachable from a test that
   * renders the page on its own, so it would arrive unproven.
   */
  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Joins a board and goes to it — but only once the server has agreed.
   *
   * Navigating on the press rather than on the answer is the obvious version
   * and it is wrong: the join can be refused, and a tab swap that happens either
   * way leaves the user staring at a scoreboard they are not in, with nothing on
   * screen to say so — a refused join is the one failure the scoreboard tab has
   * no banner for. So the navigation is the last thing to happen, and a refusal
   * keeps the user here with the reason the thunk rejected with.
   *
   * `joining` is the code in flight, and it is what makes a second tap a no-op:
   * two presses would be the same room entered twice.
   */
  const onSelect = async (code: string): Promise<void> => {
    // Every row is disabled while a join is in flight, so a second press should
    // not reach here. Stated in the handler as well, so "one room entered twice"
    // is a property of this function rather than of the pressable that guards it.
    if (joining !== null) return;

    setJoinError(null);
    setJoining(code);
    try {
      await dispatch(joinScoreboard(code)).unwrap();
      router.replace(SCOREBOARD_ROUTE);
    } catch (rejected: unknown) {
      setJoinError(reasonOf(rejected) ?? "Couldn't join that game");
    } finally {
      setJoining(null);
    }
  };

  // "Idle" counts as loading: the load is dispatched from an effect, so the
  // first frame is `idle` and rendering the list for it would flash an empty
  // board at a user who is about to be shown games.
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
      <Text className="text-white font-sans-bold text-2xl">All games</Text>

      {/*
        Above the list, not in place of it: a board another player has already
        started is still worth joining from here, and only the list's own
        freshness is in doubt. Red, and worded as a failure, so it cannot be read
        as the empty state below.
      */}
      {boardsStatus === "error" && (
        <View className="border border-red-500 gap-4 p-4">
          <Text testID="boards-error" className="text-red-500 font-sans-bold text-lg">
            {loadError ?? "Couldn't load games"}
          </Text>
          {/*
            A retry, because there is one to make: the list is a plain read, and
            a tab navigator keeps this screen mounted, so leaving and coming
            back would not fetch it again. Without this, one failed request on a
            dead network is a tab that stays wrong for the rest of the session.
          */}
          <Pressable
            onPress={() => {
              void load();
            }}
            testID="boards-retry"
            className="border border-primary px-6 py-3 self-start"
          >
            <Text className="text-white font-sans-medium text-lg">Retry</Text>
          </Pressable>
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
          // A block body, so the handler hands a press nothing to wait on:
          // `onPress` returns a promise here, and anything that awaits a
          // returned thenable waits on the join too.
          onPress={() => {
            void onSelect(board.code);
          }}
        />
      ))}
    </ScrollView>
  );
}
