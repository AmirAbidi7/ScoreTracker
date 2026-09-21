import { Context, Effect, Layer } from "effect";
import type { Request, Response } from "express";
import { StatusCodes } from "http-status-codes";
import type { ScoreboardCreateRequest, ScoreboardDTO } from "../dto/ScoreboardDTO";
import {
  ScoreboardService,
  ScoreboardServiceLive,
  type ScoreboardServiceInterface,
} from "../service/scoreboardService";
import type { ApiError } from "../errors/errors";

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
  readonly updateScoreboard: (
    req: Request<{}, {}, { scoreboard: ScoreboardDTO }>,
    res: Response,
  ) => Effect.Effect<void, ApiError>;
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

const updateScoreboard =
  (scoreboardService: ScoreboardServiceInterface) =>
  (req: Request<{}, {}, { scoreboard: ScoreboardDTO }>, res: Response) =>
    Effect.gen(function* () {
      const scoreboard = yield* scoreboardService.updateScoreboard(req.body.scoreboard);
      res.status(StatusCodes.OK).json(scoreboard);
    });

const deleteScoreboard =
  (scoreboardService: ScoreboardServiceInterface) =>
  (req: Request<{ id: string }>, res: Response) =>
    Effect.gen(function* () {
      const message = yield* scoreboardService.deleteScoreboard(req.params.id);
      res.status(StatusCodes.OK).json(message);
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

    return {
      createScoreboard: createScoreboard(scoreboardService),
      getScoreboard: getScoreboard(scoreboardService),
      getScoreboards: getScoreboards(scoreboardService),
      updateScoreboard: updateScoreboard(scoreboardService),
      deleteScoreboard: deleteScoreboard(scoreboardService),
      joinScoreboard: joinScoreboard(scoreboardService),
    };
  }),
).pipe(Layer.provide(ScoreboardServiceLive));
