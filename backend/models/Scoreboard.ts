import { jsonb, pgTable, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

export interface Player {
  id: number;
  name: string;
  score: number;
}

export const scoreboardsTable = pgTable("scoreboards", {
  id: uuid().primaryKey().defaultRandom(),
  gameName: varchar({ length: 255 }).notNull(),
  players: jsonb().$type<Player[]>().notNull().default([]),
  creationTime: timestamp({ withTimezone: true }).defaultNow(),
  updateTime: timestamp({ withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date()),
  code: varchar({ length: 6 }).unique().notNull(),
});

export type Scoreboard = typeof scoreboardsTable;
