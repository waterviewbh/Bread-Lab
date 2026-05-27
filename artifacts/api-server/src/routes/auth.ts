import { Router, type IRouter } from "express";
import { eq, and, isNull, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  recipesTable,
  feedSessionsTable,
  bakeSessionsTable,
} from "@workspace/db";
import { z } from "zod";
import { signToken, verifyToken } from "../lib/auth";

const router: IRouter = Router();

const IdentifySchema = z.object({
  firstName: z.string().min(1).max(80).trim(),
  starterName: z.string().min(1).max(80).trim(),
});

router.post("/auth/identify", async (req, res): Promise<void> => {
  const parsed = IdentifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "firstName and starterName are required (max 80 chars each)" });
    return;
  }
  const { firstName, starterName } = parsed.data;

  const rows = await db
    .select()
    .from(usersTable)
    .where(
      and(
        sql`lower(${usersTable.firstName}) = lower(${firstName})`,
        sql`lower(${usersTable.starterName}) = lower(${starterName})`
      )
    )
    .limit(1);

  let user: { id: string; firstName: string; starterName: string };

  if (rows.length > 0) {
    const existing = rows[0]!;
    user = { id: existing.id, firstName: existing.firstName, starterName: existing.starterName };
  } else {
    const id = crypto.randomUUID();
    const [inserted] = await db
      .insert(usersTable)
      .values({ id, firstName, starterName })
      .onConflictDoNothing()
      .returning();
    if (inserted) {
      user = { id: inserted.id, firstName: inserted.firstName, starterName: inserted.starterName };
    } else {
      const refetch = await db
        .select()
        .from(usersTable)
        .where(
          and(
            sql`lower(${usersTable.firstName}) = lower(${firstName})`,
            sql`lower(${usersTable.starterName}) = lower(${starterName})`
          )
        )
        .limit(1);
      if (!refetch[0]) {
        res.status(500).json({ error: "Identity conflict — please try again" });
        return;
      }
      user = { id: refetch[0].id, firstName: refetch[0].firstName, starterName: refetch[0].starterName };
    }
  }

  const token = signToken(user.id, user.firstName, user.starterName);
  res.json({ token, user });
});

router.get("/auth/me", async (req, res): Promise<void> => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const token = header.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: "Token invalid or expired" });
    return;
  }
  res.json({ user: { id: payload.userId, firstName: payload.firstName, starterName: payload.starterName } });
});

const LinkDeviceSchema = z.object({ deviceId: z.string().min(1) });

router.post("/auth/signout", (req, res): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const payload = verifyToken(header.slice(7));
  if (!payload) {
    res.status(401).json({ error: "Token invalid or expired" });
    return;
  }
  res.status(200).json({ signedOut: true });
});

router.post("/auth/claim-orphans", async (req, res): Promise<void> => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const payload = verifyToken(header.slice(7));
  if (!payload) {
    res.status(401).json({ error: "Token invalid or expired" });
    return;
  }
  const userId = payload.userId;
  const [feed, bakes, recipes] = await Promise.all([
    db
      .update(feedSessionsTable)
      .set({ userId })
      .where(isNull(feedSessionsTable.userId))
      .returning({ id: feedSessionsTable.id }),
    db
      .update(bakeSessionsTable)
      .set({ userId })
      .where(isNull(bakeSessionsTable.userId))
      .returning({ id: bakeSessionsTable.id }),
    db
      .update(recipesTable)
      .set({ userId })
      .where(isNull(recipesTable.userId))
      .returning({ id: recipesTable.id }),
  ]);
  res.json({ claimed: { feed: feed.length, bakes: bakes.length, recipes: recipes.length } });
});

router.post("/auth/link-device", async (req, res): Promise<void> => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const payload = verifyToken(header.slice(7));
  if (!payload) {
    res.status(401).json({ error: "Token invalid or expired" });
    return;
  }
  const parsed = LinkDeviceSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "deviceId required" });
    return;
  }
  const { deviceId } = parsed.data;
  const userId = payload.userId;
  await Promise.all([
    db
      .update(recipesTable)
      .set({ userId })
      .where(and(eq(recipesTable.deviceId, deviceId), isNull(recipesTable.userId))),
    db
      .update(feedSessionsTable)
      .set({ userId })
      .where(and(eq(feedSessionsTable.deviceId, deviceId), isNull(feedSessionsTable.userId))),
    db
      .update(bakeSessionsTable)
      .set({ userId })
      .where(and(eq(bakeSessionsTable.deviceId, deviceId), isNull(bakeSessionsTable.userId))),
  ]);
  res.json({ linked: true });
});

export default router;
