import { Context, Effect } from "effect";
import type { ScoreboardDTO } from "../dto/ScoreboardDTO";

class ScoreboardService extends Context.Service<
  ScoreboardService,
  {
    readonly getScoreboard: (id: string) => Effect.Effect<ScoreboardDTO>;
    readonly getScoreboards: () => Effect.Effect<ScoreboardDTO[]>;
    readonly updateScoreboard: (Scoreboard: ScoreboardDTO) => Effect.Effect<ScoreboardDTO>;
    readonly deleteScoreboard: (scoreboardId: string) => Effect.Effect<string>;
    readonly joinScoreboard: (scoreboardCode: string) => Effect.Effect<ScoreboardDTO>;
  }
>()("ScoreboardService") {}
