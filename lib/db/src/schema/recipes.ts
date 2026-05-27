import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const recipesTable = pgTable("recipes", {
  id: text("id").primaryKey(),
  deviceId: text("device_id").notNull(),
  userId: text("user_id"),
  name: text("name").notNull(),
  phases: jsonb("phases").notNull().$type<Array<{
    key: string;
    name: string;
    ingredients?: string;
    instructions?: string;
  }>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertRecipeSchema = createInsertSchema(recipesTable);
export type InsertRecipe = z.infer<typeof insertRecipeSchema>;
export type Recipe = typeof recipesTable.$inferSelect;
