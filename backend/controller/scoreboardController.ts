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
import {
  requireUserId,
  userIdOf,
  verifySessionTokenLive,
  type VerifySessionToken,
} from "../utils/auth";

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
  readonly claimScoreboard: (
    req: Request<{ id: string }>,
    res: Response,
  ) => Effect.Effect<void, ApiError>;
};
export class ScoreboardController extends Context.Service<
  ScoreboardController,
  ScoreboardControllerInterface
>()("ScoreboardController") {}

const createScoreboard =
  (scoreboardService: ScoreboardServiceInterface, verify: VerifySessionToken) =>
  (req: Request<{}, {}, { scoreboard: ScoreboardCreateRequest }>, res: Response) =>
    Effect.gen(function* () {
      const userId = yield* requireUserId(req, verify);
      const scoreboard = yield* scoreboardService.createScoreboard(req.body.scoreboard, userId);
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

const deleteScoreboard =
  (scoreboardService: ScoreboardServiceInterface, scoreboardSocket: ScoreboardSocketInterface) =>
  (req: Request<{ id: string }>, res: Response) =>
    Effect.gen(function* () {
      const code = yield* scoreboardService.deleteScoreboard(req.params.id, userIdOf(req));
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

const claimScoreboard =
  (scoreboardService: ScoreboardServiceInterface, verify: VerifySessionToken) =>
  (req: Request<{ id: string }>, res: Response) =>
    Effect.gen(function* () {
      const userId = yield* requireUserId(req, verify);
      const scoreboard = yield* scoreboardService.claimScoreboard(req.params.id, userId);
      res.status(StatusCodes.OK).json(scoreboard);
    });

export const ScoreboardControllerLive = Layer.effect(
  ScoreboardController,
  Effect.gen(function* () {
    const scoreboardService = yield* ScoreboardService;
    const scoreboardSocket = yield* ScoreboardSocket;

    return {
      createScoreboard: createScoreboard(scoreboardService, verifySessionTokenLive),
      getScoreboard: getScoreboard(scoreboardService),
      getScoreboards: getScoreboards(scoreboardService),
      deleteScoreboard: deleteScoreboard(scoreboardService, scoreboardSocket),
      joinScoreboard: joinScoreboard(scoreboardService),
      claimScoreboard: claimScoreboard(scoreboardService, verifySessionTokenLive),
    };
  }),
).pipe(Layer.provide(ScoreboardServiceLive), Layer.provide(ScoreboardSocketLive));
