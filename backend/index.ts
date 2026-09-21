import { Layer } from "effect";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { DatabaseLive } from "./config/db";
import { SocketIOLive } from "./config/websocket";
import { ScoreboardControllerImpl } from "./controller/scoreboardController";
import { ScoreboardServiceLive } from "./service/scoreboardService";

const app = express();
const server = createServer(app);
const io = new Server(server);

export const AppLayer = Layer.mergeAll(
  DatabaseLive,
  SocketIOLive(io),
  ScoreboardServiceLive,
  ScoreboardControllerImpl,
);

server.listen(process.env.PORT!, () => {
  console.log("App listening on port 3000");
});
