import { Effect } from "effect";
import type { Request } from "express";
import { UnauthorizedError } from "../errors/errors";

export type TokenClaims = { readonly userId: string };

export type VerifySessionToken = (token: string) => Effect.Effect<TokenClaims, UnauthorizedError>;

export const userIdOf = (req: Request): string | null => {
  const auth = (req as { auth?: { userId?: unknown } }).auth;
  return typeof auth?.userId === "string" ? auth.userId : null;
};

export const tokenOf = (req: Request): string | null => {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    const token = header.slice("Bearer ".length).trim();
    return token.length > 0 ? token : null;
  }
  return null;
};

export const verifySessionTokenLive: VerifySessionToken = (token: string) =>
  Effect.gen(function* () {
    if (!process.env.CLERK_SECRET_KEY) {
      return yield* Effect.fail(
        new UnauthorizedError({ message: "Authentication is not configured" }),
      );
    }
    const { verifyToken } = yield* Effect.promise(() => import("@clerk/express"));
    const claims = yield* Effect.tryPromise({
      try: () => verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY }),
      catch: () => new UnauthorizedError({ message: "Invalid or expired session" }),
    });
    if (!claims.sub) {
      return yield* Effect.fail(new UnauthorizedError({ message: "Invalid or expired session" }));
    }
    return { userId: claims.sub };
  });

export const requireUserId = (
  req: Request,
  verify: VerifySessionToken = verifySessionTokenLive,
): Effect.Effect<string, UnauthorizedError> =>
  Effect.gen(function* () {
    const direct = userIdOf(req);
    if (direct) return direct;
    const token = tokenOf(req);
    if (!token) {
      return yield* Effect.fail(new UnauthorizedError({ message: "Sign in to continue" }));
    }
    const claims = yield* verify(token);
    return claims.userId;
  });
