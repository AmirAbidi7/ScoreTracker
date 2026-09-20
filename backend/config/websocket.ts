import { Context, Layer } from "effect";
import { Server } from "socket.io";

export class SocketIO extends Context.Service<SocketIO, Server>()("WebSocket") {}

export const SocketIOLive = (io: Server) => Layer.succeed(SocketIO, io);
