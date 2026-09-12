import { pgTable, text, jsonb, timestamp, integer, boolean } from "drizzle-orm/pg-core";
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
  yieldValue: integer("yield_value"),
  totalFlourG: integer("total_flour_g"),
  hydrationPct: integer("hydration_pct"),
  parentRecipeId: text("parent_recipe_id"),
  versionLabel: text("version_label"),
  isArchived: boolean("is_archived").default(false),
});

export const insertRecipeSchema = createInsertSchema(recipesTable);
export type InsertRecipe = z.infer<typeof insertRecipeSchema>;
export type Recipe = typeof recipesTable.$inferSelect;
