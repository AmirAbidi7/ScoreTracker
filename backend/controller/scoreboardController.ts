import { Context, Effect, Layer } from "effect";
import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { ScoreboardCreateRequest } from "../dto/ScoreboardDTO";
import type { ApiError } from "../errors/errors";
import {
  ScoreboardService,
  ScoreboardServiceLive,
  type ScoreboardServiceInterface,
} from "../service/scoreboardService";
import {
  ScoreboardSocket,
  ScoreboardSocketLive,
  type ScoreboardSocketInterface,
} from "../service/scoreboardSocket";

export type ScoreboardControllerInterface = {
  readonly createScoreboard: (
    req: Request<{}, {}, { scoreboard: ScoreboardCreateRequest }>,
    res: Response,
  ) => Effect.Effect<void, ApiError>;
  readonly getScoreboard: (
    req: Request<{ id: string }>,
    res: Response,
  ) => Effect.Effect<void, ApiError>;
  readonly getScoreboards: (req: Request, res: Response) => Effect.Effect<void, ApiError>;
  readonly deleteScoreboard: (
    req: Request<{ id: string }>,
    res: Response,
  ) => Effect.Effect<void, ApiError>;
  readonly joinScoreboard: (
    req: Request<{ code: string }>,
    res: Response,
  ) => Effect.Effect<void, ApiError>;
};
export class ScoreboardController extends Context.Service<
  ScoreboardController,
  ScoreboardControllerInterface
>()("ScoreboardController") {}

const createScoreboard =
  (scoreboardService: ScoreboardServiceInterface) =>
  (req: Request<{}, {}, { scoreboard: ScoreboardCreateRequest }>, res: Response) =>
    Effect.gen(function* () {
      const scoreboard = yield* scoreboardService.createScoreboard(req.body.scoreboard);
      res.status(StatusCodes.CREATED).json(scoreboard);
    });

const getScoreboard =
  (scoreboardService: ScoreboardServiceInterface) =>
  (req: Request<{ id: string }>, res: Response) =>
    Effect.gen(function* () {
      const scoreboard = yield* scoreboardService.getScoreboard(req.params.id);
      res.status(StatusCodes.OK).json(scoreboard);
    });
const getScoreboards =
  (scoreboardService: ScoreboardServiceInterface) => (req: Request, res: Response) =>
    Effect.gen(function* () {
      const scoreboards = yield* scoreboardService.getScoreboards();
      res.status(StatusCodes.OK).json(scoreboards);
    });

/**
 * No `updateScoreboard` here, deliberately. It took a board from the request body
 * and wrote it, so any HTTP client could author a score — which is the one thing
 * the intents path exists to prevent. See the note in `routes/scoreboardController.ts`.
 */
const deleteScoreboard =
  (scoreboardService: ScoreboardServiceInterface, scoreboardSocket: ScoreboardSocketInterface) =>
  (req: Request<{ id: string }>, res: Response) =>
    Effect.gen(function* () {
      const code = yield* scoreboardService.deleteScoreboard(req.params.id);
      yield* scoreboardSocket.disconnectFromScoreboard(code);
      res.status(StatusCodes.OK).json("Scoreboard deleted successfully!");
    });

const joinScoreboard =
  (scoreboardService: ScoreboardServiceInterface) =>
  (req: Request<{ code: string }>, res: Response) =>
    Effect.gen(function* () {
      const scoreboard = yield* scoreboardService.joinScoreboard(req.params.code);
      res.status(StatusCodes.OK).json(scoreboard);
    });

export const ScoreboardControllerLive = Layer.effect(
  ScoreboardController,
  Effect.gen(function* () {
    const scoreboardService = yield* ScoreboardService;
    const scoreboardSocket = yield* ScoreboardSocket;

    return {
      createScoreboard: createScoreboard(scoreboardService),
      getScoreboard: getScoreboard(scoreboardService),
      getScoreboards: getScoreboards(scoreboardService),
      deleteScoreboard: deleteScoreboard(scoreboardService, scoreboardSocket),
      joinScoreboard: joinScoreboard(scoreboardService),
    };
  }),
).pipe(Layer.provide(ScoreboardServiceLive), Layer.provide(ScoreboardSocketLive));
