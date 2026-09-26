import { useEffect } from "react";
import { router } from "expo-router";
import { scoreboardService, type ServiceEvent } from "./domain/ScoreboardService";
import { clearSavedSession } from "./domain/ScoreboardSession";
import { useAppDispatch } from "../../../store";
import { applyBoard, resetScoreboard, setError, setStatus } from "./scoreTrackingSlice";
import { restoreSession } from "./scoreTrackingThunks";

/** The Join tab, where a user with no board has something to do next. */
const JOIN_ROUTE = "/(main)/(scoreTracking)/syncGame";

/**
 * Bridges gateway events into the store, once, for the lifetime of the app.
 *
 * Mounted in the (main) layout rather than inside a screen so switching tabs
 * never tears down the connection, and so a board deleted by another device
 * can redirect from wherever the user happens to be.
 *
 * The service is a module singleton that emits to every subscriber, so this is
 * the only place its events reach redux. Thunks answer for their own requests;
 * this answers for the ones nobody asked about — another player's score, a
 * reconnect, a board that no longer exists.
 */
export const useScoreboardSync = (): void => {
  const dispatch = useAppDispatch();

  useEffect(() => {
    const onEvent = (event: ServiceEvent) => {
      switch (event.type) {
        case "status":
          dispatch(setStatus(event.status));
          break;
        case "board":
          dispatch(applyBoard(event.board));
          break;
        case "error":
          dispatch(setError(event.message));
          break;
        case "disconnected":
          // The owner deleted the board we were following. The session pointer
          // is worthless now, and a stale one would rejoin this board on the
          // next cold start and land the user back on a 404.
          //
          // Best effort, and deliberately not awaited: `clearSavedSession`
          // leaves its rejections to the caller, and letting one escape this
          // synchronous listener would surface as an unhandled rejection. A
          // storage failure costs one stale entry, which the next successful
          // write replaces — far cheaper than a global error on every delete.
          void clearSavedSession().catch(() => {});
          dispatch(resetScoreboard());
          router.replace(JOIN_ROUTE);
          break;
      }
    };

    // Subscribed before the restore, so the board the restore causes cannot
    // arrive before there is anything listening for it.
    const unsubscribe = scoreboardService.subscribe(onEvent);
    void dispatch(restoreSession());

    return unsubscribe;
  }, [dispatch]);
};
