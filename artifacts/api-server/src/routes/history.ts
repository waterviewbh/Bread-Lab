import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, and, or, isNull } from "drizzle-orm";
import { db, feedSessionsTable, bakeSessionsTable } from "@workspace/db";
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

const UpsertFeedSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  savedAt: z.number(),
  startedAt: z.number().nullable().optional(),
  data: z.record(z.unknown()),
});

const BakePhaseReadingSchema = z.object({
  id: z.string(),
  temp: z.string(),
  tempUnit: z.enum(["F", "C"]),
  pH: z.string(),
  note: z.string(),
  loggedAt: z.number(),
});

const BakePhaseSchema = z.object({
  key: z.string(),
  name: z.string(),
  ingredients: z.string().optional(),
  instructions: z.string().optional(),
  startedAt: z.number().nullable().optional(),
  completedAt: z.number().nullable().optional(),
  readings: z.array(BakePhaseReadingSchema).optional(),
  startVolume: z.string().optional(),
});

const UpsertBakeSchema = z.object({
  id: z.string(),
  deviceId: z.string(),
  recipeId: z.string().nullable().optional(),
  recipeName: z.string(),
  savedAt: z.number(),
  startedAt: z.number(),
  phases: z.array(BakePhaseSchema),
  inProgress: z.boolean().optional().default(false),
});

router.get("/history/feed", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (rejectIfUnauthorized(auth, res)) return;
  const userId = auth?.userId ?? null;
  const deviceId = req.query["deviceId"];

  if (!userId && (typeof deviceId !== "string" || !deviceId)) {
    res.status(400).json({ error: "deviceId query param required when not authenticated" });
    return;
  }

  const whereClause = userId
    ? eq(feedSessionsTable.userId, userId)
    : and(eq(feedSessionsTable.deviceId, deviceId as string), isNull(feedSessionsTable.userId));

  const rows = await db
    .select()
    .from(feedSessionsTable)
    .where(whereClause)
    .orderBy(desc(feedSessionsTable.savedAt))
    .limit(500);

  res.json(rows);
});

router.post("/history/feed", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (rejectIfUnauthorized(auth, res)) return;

  const parsed = UpsertFeedSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = auth?.userId ?? null;
  const { id, deviceId, savedAt, startedAt, data } = parsed.data;

  const ownerUpdateWhere = userId
    ? or(
        and(isNull(feedSessionsTable.userId), eq(feedSessionsTable.deviceId, deviceId)),
        eq(feedSessionsTable.userId, userId)
      )
    : and(isNull(feedSessionsTable.userId), eq(feedSessionsTable.deviceId, deviceId));

  const [row] = await db
    .insert(feedSessionsTable)
    .values({ id, deviceId, userId, savedAt, startedAt: startedAt ?? null, data })
    .onConflictDoUpdate({
      target: feedSessionsTable.id,
      set: { savedAt, startedAt: startedAt ?? null, data, userId },
      where: ownerUpdateWhere,
    })
    .returning();

  if (!row) {
    res.status(409).json({ error: "Record conflict — not authorized to update" });
    return;
  }

  res.json(row);
});

router.get("/history/bakes/active", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (rejectIfUnauthorized(auth, res)) return;
  const userId = auth?.userId ?? null;
  const deviceId = req.query["deviceId"];

  if (!userId && (typeof deviceId !== "string" || !deviceId)) {
    res.status(400).json({ error: "deviceId query param required when not authenticated" });
    return;
  }

  const whereClause = userId
    ? and(eq(bakeSessionsTable.userId, userId), eq(bakeSessionsTable.inProgress, true))
    : and(
        eq(bakeSessionsTable.deviceId, deviceId as string),
        isNull(bakeSessionsTable.userId),
        eq(bakeSessionsTable.inProgress, true)
      );

  const rows = await db
    .select()
    .from(bakeSessionsTable)
    .where(whereClause)
    .orderBy(desc(bakeSessionsTable.savedAt))
    .limit(1);

  res.json(rows[0] ?? null);
});

router.get("/history/bakes", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (rejectIfUnauthorized(auth, res)) return;
  const userId = auth?.userId ?? null;
  const deviceId = req.query["deviceId"];

  if (!userId && (typeof deviceId !== "string" || !deviceId)) {
    res.status(400).json({ error: "deviceId query param required when not authenticated" });
    return;
  }

  const whereClause = userId
    ? and(eq(bakeSessionsTable.userId, userId), eq(bakeSessionsTable.inProgress, false))
    : and(
        eq(bakeSessionsTable.deviceId, deviceId as string),
        isNull(bakeSessionsTable.userId),
        eq(bakeSessionsTable.inProgress, false)
      );

  const rows = await db
    .select()
    .from(bakeSessionsTable)
    .where(whereClause)
    .orderBy(desc(bakeSessionsTable.savedAt))
    .limit(200);

  res.json(rows);
});

router.post("/history/bakes", async (req, res): Promise<void> => {
  const auth = getAuth(req);
  if (rejectIfUnauthorized(auth, res)) return;

  const parsed = UpsertBakeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const userId = auth?.userId ?? null;
  const { id, deviceId, recipeId, recipeName, savedAt, startedAt, phases, inProgress } = parsed.data;

  const ownerUpdateWhere = userId
    ? or(
        and(isNull(bakeSessionsTable.userId), eq(bakeSessionsTable.deviceId, deviceId)),
        eq(bakeSessionsTable.userId, userId)
      )
    : and(isNull(bakeSessionsTable.userId), eq(bakeSessionsTable.deviceId, deviceId));

  const [row] = await db
    .insert(bakeSessionsTable)
    .values({
      id,
      deviceId,
      userId,
      recipeId: recipeId ?? null,
      recipeName,
      savedAt,
      startedAt,
      phases,
      inProgress: inProgress ?? false,
    })
    .onConflictDoUpdate({
      target: bakeSessionsTable.id,
      set: { recipeId: recipeId ?? null, recipeName, savedAt, startedAt, phases, userId, inProgress: inProgress ?? false },
      where: ownerUpdateWhere,
    })
    .returning();

  if (!row) {
    res.status(409).json({ error: "Record conflict — not authorized to update" });
    return;
  }

  res.json(row);
});

router.delete("/history/feed/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!id) { res.status(400).json({ error: "id required" }); return; }

  const auth = getAuth(req);
  if (rejectIfUnauthorized(auth, res)) return;
  const userId = auth?.userId ?? null;
  const deviceId = req.query["deviceId"];

  if (!userId && (typeof deviceId !== "string" || !deviceId)) {
    res.status(400).json({ error: "deviceId query param required when not authenticated" });
    return;
  }

  const ownerClause = userId
    ? eq(feedSessionsTable.userId, userId)
    : and(eq(feedSessionsTable.deviceId, deviceId as string), isNull(feedSessionsTable.userId));

  const deleted = await db
    .delete(feedSessionsTable)
    .where(and(eq(feedSessionsTable.id, id), ownerClause))
    .returning({ id: feedSessionsTable.id });

  if (deleted.length === 0) {
    res.status(404).json({ error: "Entry not found or access denied" });
    return;
  }

  res.status(204).send();
});

router.delete("/history/bakes/:id", async (req, res): Promise<void> => {
  const { id } = req.params;
  if (!id) { res.status(400).json({ error: "id required" }); return; }

  const auth = getAuth(req);
  if (rejectIfUnauthorized(auth, res)) return;
  const userId = auth?.userId ?? null;
  const deviceId = req.query["deviceId"];

  if (!userId && (typeof deviceId !== "string" || !deviceId)) {
    res.status(400).json({ error: "deviceId query param required when not authenticated" });
    return;
  }

  const ownerClause = userId
    ? eq(bakeSessionsTable.userId, userId)
    : and(eq(bakeSessionsTable.deviceId, deviceId as string), isNull(bakeSessionsTable.userId));

  const deleted = await db
    .delete(bakeSessionsTable)
    .where(and(eq(bakeSessionsTable.id, id), ownerClause))
    .returning({ id: bakeSessionsTable.id });

  if (deleted.length === 0) {
    res.status(404).json({ error: "Entry not found or access denied" });
    return;
  }

  res.status(204).send();
});

export default router;
