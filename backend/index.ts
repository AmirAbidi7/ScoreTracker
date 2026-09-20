import { Layer } from "effect";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { DatabaseLive } from "./config/db";
import { SocketIOLive } from "./config/websocket";

const app = express();
const server = createServer(app);
const io = new Server(server);

const AppLayer = Layer.mergeAll(DatabaseLive, SocketIOLive(io));

server.listen(process.env.PORT!, () => {
  console.log("App listening on port 3000");
});
