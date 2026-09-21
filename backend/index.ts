import { Layer } from "effect";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { DatabaseLive } from "./config/db";
import { SocketIOLive } from "./config/websocket";
import { ScoreboardServiceLive } from "./service/scoreboardService";
import { ScoreboardControllerLive } from "./controller/scoreboardController";

const app = express();
const server = createServer(app);
const io = new Server(server);

export const AppLayer = Layer.mergeAll(
  DatabaseLive,
  SocketIOLive(io),
  ScoreboardServiceLive,
  ScoreboardControllerLive,
);

server.listen(process.env.PORT!, () => {
  console.log("App listening on port 3000");
});
