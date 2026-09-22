import { Data } from "effect";
import { StatusCodes } from "http-status-codes";

export class NotFoundError extends Data.TaggedError("NotFoundError")<{
  message: string;
}> {
  readonly code = StatusCodes.NOT_FOUND;
}

export class UnauthorizedError extends Data.TaggedError("UnauthorizedError")<{
  message: string;
}> {
  readonly code = StatusCodes.UNAUTHORIZED;
}

export class ValidationError extends Data.TaggedError("ValidationError")<{
  message: string;
  fields: Record<string, string>;
}> {
  readonly code = StatusCodes.BAD_REQUEST;
}

export class InternalServerError extends Data.TaggedError("InternalServerError")<{
  message: string;
}> {
  readonly code = StatusCodes.INTERNAL_SERVER_ERROR;
}

export type ApiError = NotFoundError | UnauthorizedError | ValidationError | InternalServerError;
