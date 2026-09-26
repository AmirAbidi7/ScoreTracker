import { clsx } from "clsx";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";
import { colors } from "../../../../constants/theme";
import { useAppDispatch, useAppSelector } from "../../../../store";
import type { Scoreboard } from "../../scoreTracking/domain/Scoreboard";
import { rejectionReason } from "../../scoreTracking/rejectionReason";
import { joinScoreboard, loadScoreboards } from "../../scoreTracking/scoreTrackingThunks";

/** The Scoreboard tab, which is where a board that was joined is shown. */
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
      // The "Open" label below is a child of this pressable, and an
      // `accessibilityLabel` on the pressable replaces what a screen reader
      // would otherwise read out — including the fact that this is the board
      // being played. `selected` is what carries that part.
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
    // A refusal to join is news about the list as it was, and this is a request
    // for the list as it is. Left up, it is a message that has stopped being
    // true with nothing on screen able to take it away.
    setJoinError(null);
    try {
      const result = await dispatch(loadScoreboards());
      if (loadScoreboards.rejected.match(result)) {
        setLoadError(rejectionReason(result) ?? "Couldn't load games");
      }
    } catch {
      // Not reachable: `dispatch` of a thunk settles as an action rather than
      // rejecting, and the thunk catches its own failures. Kept so a thunk that
      // starts throwing cannot take the tab down with it.
      setLoadError("Couldn't load games");
    }
  }, [dispatch]);

  /**
   * Re-read on every visit, not on the first one.
   *
   * A tab navigator keeps a tab mounted once it has been opened, so a list read
   * on mount alone goes stale for the rest of the session: create a game on the
   * Join tab, come back here, and the new game is missing with nothing on screen
   * to say the list is old. The tab exists to find games, and a list that cannot
   * be brought up to date under-reports — so the read is bound to focus, which is
   * when the user has just asked to see it.
   *
   * The callback is memoised because this is what decides when it re-runs, and
   * it is a block body so what focus receives is not a promise to wait on.
   */
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

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
      const result = await dispatch(joinScoreboard(code));
      if (joinScoreboard.rejected.match(result)) {
        setJoinError(rejectionReason(result) ?? "Couldn't join that game");
      } else {
        router.replace(SCOREBOARD_ROUTE);
      }
    } catch {
      // Not reachable, as in `load`. Kept so an unexpected throw is reported
      // rather than escaping `void onSelect(…)` as an unhandled rejection, which
      // would leave the user on this tab with nothing said.
      setJoinError("Couldn't join that game");
    } finally {
      setJoining(null);
    }
  };

  // "Idle" counts as loading: the read is dispatched from the focus effect, so
  // the first frame is `idle` and rendering the list for it would flash an empty
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
      {/*
        A refresh the user can ask for, in every state that has a list — not only
        after a failure. Refocusing the tab re-reads it, but a user who is
        already looking at a list that is missing the game they just started is
        not going to leave and come back; that is what a refresh control is for.
      */}
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

      {/*
        Above the list, not in place of it: a board another player has already
        started is still worth joining from here, and only the list's own
        freshness is in doubt. Red, and worded as a failure, so it cannot be read
        as the empty state below.
      */}
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
