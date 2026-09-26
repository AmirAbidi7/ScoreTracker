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
import { ScoreboardSocket, ScoreboardSocketLive, type ScoreboardSocketInterface } from "../service/scoreboardSocket";

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

/**
 * `AppLayer`, built once per process.
 *
 * Every call to `Effect.provide(AppLayer)` builds the layer afresh, and building
 * it opens pools: this module used to be provided the layer three times over —
 * once by the router, twice by the socket handlers — so six pools existed for
 * the lifetime of the process, none of them ever `end()`ed, and the intent
 * service's serialising lock was three different locks.
 *
 * The services are stateless apart from their pool, so there is nothing to gain
 * from a second copy and only connections to lose.
 */
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
