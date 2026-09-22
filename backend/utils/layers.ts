import { Layer } from "effect";
import { DatabaseLive } from "../config/db";
import { SocketIOLive } from "../config/websocket";
import { ScoreboardControllerLive } from "../controller/scoreboardController";
import { ScoreboardServiceLive } from "../service/scoreboardService";
import { ScoreboardSocketLive } from "../service/scoreboardSocket";

export const AppLayer = Layer.mergeAll(
  DatabaseLive,
  SocketIOLive,
  ScoreboardServiceLive,
  ScoreboardControllerLive,
  ScoreboardSocketLive,
);
