import { Router, type NextFunction, type Request, type Response } from "express";
import { ScoreboardController } from "../controller/scoreboardController";
import { runController } from "../utils/controllerHelper";
import { appServices } from "../utils/layers";

const { scoreboardController } = appServices();

export const scoreboardRouter = Router();

const clerkGuard = (req: Request, _res: Response, next: NextFunction): void => {
  if (!process.env.CLERK_SECRET_KEY) {
    next();
    return;
  }
  void import("@clerk/express")
    .then(({ clerkMiddleware }) => clerkMiddleware()(req, _res, next))
    .catch(() => next());
};

scoreboardRouter.use(clerkGuard);

scoreboardRouter
  .route("/scoreboard")
  .post((req: Request, res: Response) =>
    runController(scoreboardController.createScoreboard(req, res), res),
  )
  .get((req: Request, res: Response) =>
    runController(scoreboardController.getScoreboards(req, res), res),
  );

scoreboardRouter
  .route("/scoreboard/join/:code")
  .get((req: Request<{ code: string }>, res: Response) =>
    runController(scoreboardController.joinScoreboard(req, res), res),
  );

scoreboardRouter
  .route("/scoreboard/:id/claim")
  .post((req: Request<{ id: string }>, res: Response) =>
    runController(scoreboardController.claimScoreboard(req, res), res),
  );

scoreboardRouter
  .route("/scoreboard/:id")
  .get((req: Request<{ id: string }>, res: Response) =>
    runController(scoreboardController.getScoreboard(req, res), res),
  )
  .delete((req: Request<{ id: string }>, res: Response) =>
    runController(scoreboardController.deleteScoreboard(req, res), res),
  );
