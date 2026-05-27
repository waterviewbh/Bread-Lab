import { pgTable, text, bigint, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bakeSessionsTable = pgTable("bake_sessions", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  userId: text("user_id"),
  recipeId: text("recipe_id"),
  recipeName: text("recipe_name").notNull(),
  savedAt: bigint("saved_at", { mode: "number" }).notNull(),
  startedAt: bigint("started_at", { mode: "number" }).notNull(),
  phases: jsonb("phases").notNull().$type<Array<{
    key: string;
    name: string;
    startedAt?: number | null;
    completedAt?: number | null;
    readings?: Array<{
      id: string;
      temp: string;
      tempUnit: "F" | "C";
      pH: string;
      note: string;
      loggedAt: number;
    }>;
  }>>(),
  inProgress: boolean("in_progress").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertBakeSessionSchema = createInsertSchema(bakeSessionsTable);
export type InsertBakeSession = z.infer<typeof insertBakeSessionSchema>;
export type BakeSession = typeof bakeSessionsTable.$inferSelect;
