import { pgTable, text, bigint, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const feedSessionsTable = pgTable("feed_sessions", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  userId: text("user_id"),
  savedAt: bigint("saved_at", { mode: "number" }).notNull(),
  startedAt: bigint("started_at", { mode: "number" }),
  data: jsonb("data").notNull().$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertFeedSessionSchema = createInsertSchema(feedSessionsTable);
export type InsertFeedSession = z.infer<typeof insertFeedSessionSchema>;
export type FeedSession = typeof feedSessionsTable.$inferSelect;
