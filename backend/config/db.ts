import { drizzle } from "drizzle-orm/node-postgres";
import { Context, Effect, Layer } from "effect";
import { scoreboardsTable } from "../models/Scoreboard";

export type Db = ReturnType<typeof drizzle>;

export class Database extends Context.Service<Database, Db>()("Database", {
  make: Effect.sync(() => drizzle(process.env.DATABASE_URL!)),
}) {}

export const DatabaseLive = Layer.effect(Database, Database.make);
