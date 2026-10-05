import { useEffect } from "react";
import { apiClient } from "../../../infrastructure/api/client";
import { scoreboardService } from "../scoreTracking/domain/ScoreboardService";
import { useSafeAuth } from "./safeAuth";

export const useAuthTokenBridge = (): void => {
  const { getToken, isSignedIn } = useSafeAuth();

  useEffect(() => {
    if (!isSignedIn) {
      apiClient.setTokenProvider(null);
      scoreboardService.setTokenProvider(null);
      return;
    }
    const provider = (): Promise<string | null> => getToken();
    apiClient.setTokenProvider(provider);
    scoreboardService.setTokenProvider(provider);
  }, [getToken, isSignedIn]);
};
