import { Context, Layer } from "effect";
import { Server } from "socket.io";
import { io } from "../app";

export class SocketIO extends Context.Service<SocketIO, Server>()("WebSocket") {}

export const SocketIOInterface = (io: Server) => Layer.succeed(SocketIO, io);

export const SocketIOLive = SocketIOInterface(io);
