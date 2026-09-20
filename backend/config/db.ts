import { drizzle } from "drizzle-orm/node-postgres";

const db = drizzle(process.env.DATABASE_URL!);

export class Database extends Context.Service<Database, Db>()("Database", {
  make: Effect.sync(() => drizzle(process.env.DATABASE_URL!)),
}) {}

export const DatabaseLive = Layer.effect(Database, Database.make);

const program = Effect.gen(function* () {
  const db = yield* Database;
  db.query();
});
