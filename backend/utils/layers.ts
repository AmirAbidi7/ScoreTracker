import { Effect, Layer } from "effect";
import { DatabaseLive } from "../config/db";
import { SocketIOLive } from "../config/websocket";
import {
  ScoreboardController,
  ScoreboardControllerLive,
  type ScoreboardControllerInterface,
} from "../controller/scoreboardController";
import {
  ScoreboardIntentService,
  ScoreboardIntentServiceLive,
  type ScoreboardIntentServiceInterface,
} from "../service/scoreboardIntentService";
import { ScoreboardServiceLive } from "../service/scoreboardService";
import {
  ScoreboardSocket,
  ScoreboardSocketLive,
  type ScoreboardSocketInterface,
} from "../service/scoreboardSocket";

export const AppLayer = Layer.mergeAll(
  DatabaseLive,
  SocketIOLive,
  ScoreboardServiceLive,
  ScoreboardControllerLive,
  ScoreboardSocketLive,
  ScoreboardIntentServiceLive,
);

export type AppServices = {
  readonly scoreboardController: ScoreboardControllerInterface;
  readonly intentService: ScoreboardIntentServiceInterface;
  readonly socketService: ScoreboardSocketInterface;
};

let built: AppServices | null = null;

export const appServices = (): AppServices => {
  if (built) return built;

  built = Effect.runSync(
    Effect.gen(function* () {
      return {
        scoreboardController: yield* ScoreboardController,
        intentService: yield* ScoreboardIntentService,
        socketService: yield* ScoreboardSocket,
      };
    }).pipe(Effect.provide(AppLayer)),
  );

  return built;
};
