import { Effect } from "effect";
import type { ApiError } from "../errors/errors";
import type { Response } from "express";

export const runController = (effect: Effect.Effect<void, ApiError>, res: Response) =>
  Effect.runPromise(
    effect.pipe(
      Effect.catchTags({
        InternalServerError: handleErrors(res),
        NotFoundError: handleErrors(res),
        ValidationError: handleErrors(res),
        UnauthorizedError: handleErrors(res),
      }),
    ),
  );

const handleErrors = (res: Response) => (err: ApiError) =>
  Effect.sync(() => {
    res.status(err.code).json({ message: err.message, code: err.code });
  });
