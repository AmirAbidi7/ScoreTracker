import { Router, type Request, type Response } from "express";
import { ScoreboardController } from "../controller/scoreboardController";
import { runController } from "../utils/controllerHelper";
import { appServices } from "../utils/layers";

/**
 * There is no `PUT /api/scoreboard`, and that is the point.
 *
 * It took a whole board — `players`, `code`, `gameName` — from the request body
 * and wrote it, then broadcast the result to the room: the one path left in which
 * a client could author a score. Nothing in the app called it, and the intents
 * path (`scoreboard:intent` → `applyIntent`) is the only supported way to change
 * a board. Do not add a REST write back, and do not re-add this one.
 */
const { scoreboardController } = appServices();

export const scoreboardRouter = Router();

scoreboardRouter
  .route("/scoreboard")
  .post((req: Request, res: Response) =>
    runController(scoreboardController.createScoreboard(req, res), res),
  )
  .get((req: Request, res: Response) =>
    runController(scoreboardController.getScoreboards(req, res), res),
  );

// Registered before `/:id` so a code can never be read as an id. The segment
// counts differ, so Express would not match them anyway, but the explicit
// order makes the intent obvious to the next reader.
scoreboardRouter
  .route("/scoreboard/join/:code")
  .get((req: Request<{ code: string }>, res: Response) =>
    runController(scoreboardController.joinScoreboard(req, res), res),
  );

scoreboardRouter
  .route("/scoreboard/:id")
  .get((req: Request<{ id: string }>, res: Response) =>
    runController(scoreboardController.getScoreboard(req, res), res),
  )
  .delete((req: Request<{ id: string }>, res: Response) =>
    runController(scoreboardController.deleteScoreboard(req, res), res),
  );
