import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, or, isNull } from "drizzle-orm";
import { db, recipesTable } from "@workspace/db";
import { z } from "zod";
import { verifyToken } from "../lib/auth";

const router: IRouter = Router();

type AuthResult = { userId: string } | null | "unauthorized";

function getAuth(req: Request): AuthResult {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const payload = verifyToken(header.slice(7));
  if (!payload) return "unauthorized";
  return { userId: payload.userId };
}

function rejectIfUnauthorized(auth: AuthResult, res: Response): auth is "unauthorized" {
  if (auth === "unauthorized") {
    res.status(401).json({ error: "Invalid or expired token" });
    return true;
  }
  return false;
}

const RecipePhaseSchema = z.object({
  key: z.string(),
  name: z.string(),
  ingredients: z.string().optional(),
  instructions: z.string().optional(),
});

const UpsertRecipeSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  name: z.string().min(1),
  phases: z.array(RecipePhaseSchema),
});

router.get("/recipes", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (rejectIfUnauthorized(auth, res)) return;
  const userId = auth?.userId ?? null;
  const deviceId = req.query["deviceId"];

  if (!userId && (typeof deviceId !== "string" || !deviceId)) {
    res.status(400).json({ error: "deviceId query param required when not authenticated" });
    return;
  }

  const whereClause = userId
    ? eq(recipesTable.userId, userId)
    : and(eq(recipesTable.deviceId, deviceId as string), isNull(recipesTable.userId));

  const rows = await db
    .select()
    .from(recipesTable)
    .where(whereClause)
    .orderBy(recipesTable.createdAt);

  res.json(rows);
});

router.post("/recipes", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (rejectIfUnauthorized(auth, res)) return;

  const parsed = UpsertRecipeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = auth?.userId ?? null;
  const { id, deviceId, name, phases } = parsed.data;
  const now = new Date();

  const ownerUpdateWhere = userId
    ? or(
        and(isNull(recipesTable.userId), eq(recipesTable.deviceId, deviceId)),
        eq(recipesTable.userId, userId)
      )
    : and(isNull(recipesTable.userId), eq(recipesTable.deviceId, deviceId));

  const [row] = await db
    .insert(recipesTable)
    .values({ id, deviceId, userId, name, phases, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: recipesTable.id,
      set: { name, phases, userId, updatedAt: now },
      where: ownerUpdateWhere,
    })
    .returning();

  if (!row) {
    res.status(409).json({ error: "Record conflict — not authorized to update" });
    return;
  }

  res.status(201).json(row);
});

router.put("/recipes/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const auth = getAuth(req);
  if (rejectIfUnauthorized(auth, res)) return;

  const parsed = UpsertRecipeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = auth?.userId ?? null;
  const { deviceId, name, phases } = parsed.data;
  const now = new Date();

  const ownerClause = userId
    ? eq(recipesTable.userId, userId)
    : and(eq(recipesTable.deviceId, deviceId), isNull(recipesTable.userId));

  const [row] = await db
    .update(recipesTable)
    .set({ name, phases, userId, updatedAt: now })
    .where(and(eq(recipesTable.id, rawId), ownerClause))
    .returning();

  if (!row) {
    res.status(404).json({ error: "Recipe not found or access denied" });
    return;
  }

  res.json(row);
});

router.delete("/recipes/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params["id"]) ? req.params["id"][0] : req.params["id"];
  const auth = getAuth(req);
  if (rejectIfUnauthorized(auth, res)) return;
  const userId = auth?.userId ?? null;
  const deviceId = req.query["deviceId"];

  if (!userId && (typeof deviceId !== "string" || !deviceId)) {
    res.status(400).json({ error: "deviceId query param required when not authenticated" });
    return;
  }

  const ownerClause = userId
    ? eq(recipesTable.userId, userId)
    : and(eq(recipesTable.deviceId, deviceId as string), isNull(recipesTable.userId));

  const deleted = await db
    .delete(recipesTable)
    .where(and(eq(recipesTable.id, rawId), ownerClause))
    .returning({ id: recipesTable.id });

  if (deleted.length === 0) {
    res.status(404).json({ error: "Recipe not found or access denied" });
    return;
  }

  res.sendStatus(204);
});

export default router;
