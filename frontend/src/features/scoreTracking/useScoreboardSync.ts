import { useEffect } from "react";
import { router } from "expo-router";
import { scoreboardService, type ServiceEvent } from "./domain/ScoreboardService";
import { clearSavedSession } from "./domain/ScoreboardSession";
import { useAppDispatch } from "../../../store";
import { applyBoard, resetScoreboard, setError, setStatus } from "./scoreTrackingSlice";
import { restoreSession } from "./scoreTrackingThunks";

const JOIN_ROUTE = "/(main)/(scoreTracking)/syncGame";

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
          void clearSavedSession().catch(() => {});
          dispatch(resetScoreboard());
          router.replace(JOIN_ROUTE);
          break;
      }
    };

    const unsubscribe = scoreboardService.subscribe(onEvent);
    void dispatch(restoreSession());

    return unsubscribe;
  }, [dispatch]);
};
