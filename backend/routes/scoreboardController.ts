import { Effect } from "effect";
import type { Request, Response } from "express";
import { app, AppLayer } from "..";
import { ScoreboardController } from "../controller/scoreboardController";
import { runController } from "../utils/controllerHelper";
import type { ScoreboardDTO } from "../dto/ScoreboardDTO";

const scoreboardController = Effect.runSync(
  Effect.gen(function* () {
    return yield* ScoreboardController;
  }).pipe(Effect.provide(AppLayer)),
);

const scoreboardRouter = app.router;

scoreboardRouter
  .route("/scoreboard")
  .post((req: Request, res: Response) =>
    runController(scoreboardController.createScoreboard(req, res), res),
  )
  .get((req: Request, res: Response) =>
    runController(scoreboardController.getScoreboards(req, res), res),
  )
  .put((req: Request<{}, {}, { scoreboard: ScoreboardDTO }>, res: Response) =>
    runController(scoreboardController.updateScoreboard(req, res), res),
  )
  .delete((req: Request<{ id: string }>, res: Response) =>
    runController(scoreboardController.deleteScoreboard(req, res), res),
  );

scoreboardRouter
  .route("/scoreboard/:id")
  .get((req: Request<{ id: string }>, res: Response) =>
    runController(scoreboardController.getScoreboard(req, res), res),
  );
