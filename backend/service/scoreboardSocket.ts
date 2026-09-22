import { Context, Effect, Layer } from "effect";
import type { Server } from "socket.io";
import { SocketIO, SocketIOLive } from "../config/websocket";
import type { ScoreboardDTO } from "../dto/ScoreboardDTO";
import { InternalServerError } from "../errors/errors";

export type ScoreboardSocketInterface = {
  readonly updateScoreboard: (
    scoreboard: ScoreboardDTO,
  ) => Effect.Effect<void, InternalServerError>;
  readonly disconnectFromScoreboard: (code: string) => Effect.Effect<void, InternalServerError>;
};

export class ScoreboardSocket extends Context.Service<
  ScoreboardSocket,
  ScoreboardSocketInterface
>()("ScoreboardSocket") {}

const updateScoreboard = (socket: Server) => (scoreboard: ScoreboardDTO) =>
  Effect.gen(function* () {
    yield* Effect.try({
      try: () => socket.to(`scoreboard:${scoreboard.code}`).emit("scoreboard:update", scoreboard),
      catch: () =>
        new InternalServerError({
          message: `sending socket message for scoreboard with code ${scoreboard.code} failed!`,
        }),
    });
  });

const disconnectFromScoreboard = (socket: Server) => (code: string) =>
  Effect.gen(function* () {
    const message = yield* Effect.try({
      try: () => socket.to(`scoreboard:${code}`).emit("scoreboard:disconnect"),
      catch: () =>
        new InternalServerError({
          message: `Failed to send socket message to scoreboard with code ${code}`,
        }),
    });
  });
export const ScoreboardSocketLive = Layer.effect(
  ScoreboardSocket,
  Effect.gen(function* () {
    const socket = yield* SocketIO;

    return ScoreboardSocket.of({
      updateScoreboard: updateScoreboard(socket),
      disconnectFromScoreboard: disconnectFromScoreboard(socket),
    });
  }),
).pipe(Layer.provide(SocketIOLive));
