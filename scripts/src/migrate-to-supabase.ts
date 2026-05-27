/**
 * One-time migration: copy all records from Replit PostgreSQL into Supabase,
 * creating a user row keyed by first name + starter name.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts tsx src/migrate-to-supabase.ts "FirstName" "StarterName"
 */

import pg from "pg";

const { Client } = pg;

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY env vars.");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL env var.");
  process.exit(1);
}

const [, , firstName, starterName] = process.argv;
if (!firstName || !starterName) {
  console.error('Usage: tsx src/migrate-to-supabase.ts "FirstName" "StarterName"');
  process.exit(1);
}

function genId(): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length: 32 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

async function sbFetch(path: string, body: unknown, method = "POST") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    method,
    headers: {
      "apikey": SUPABASE_KEY!,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase ${method} ${path} → ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function main() {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();

  console.log(`\nMigrating data for: "${firstName}" / "${starterName}"\n`);

  // ── 1. Upsert user in Supabase ────────────────────────────────────────────
  // Check if user already exists (case-insensitive).
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/users?first_name=ilike.${encodeURIComponent(firstName)}&starter_name=ilike.${encodeURIComponent(starterName)}&select=id,first_name,starter_name`,
    {
      headers: {
        "apikey": SUPABASE_KEY!,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
      },
    }
  );
  const existing: { id: string; first_name: string; starter_name: string }[] =
    await checkRes.json();

  let userId: string;
  if (existing.length > 0) {
    userId = existing[0].id;
    console.log(`✓ Found existing Supabase user: ${userId}`);
  } else {
    userId = genId();
    await sbFetch("/users", {
      id: userId,
      first_name: firstName.trim(),
      starter_name: starterName.trim(),
    });
    console.log(`✓ Created Supabase user: ${userId}`);
  }

  // ── 2. Read source data from Replit PostgreSQL ────────────────────────────
  const feedRes = await client.query(
    "SELECT * FROM feed_sessions ORDER BY saved_at ASC"
  );
  const bakeRes = await client.query(
    "SELECT * FROM bake_sessions ORDER BY saved_at ASC"
  );
  const recipeRes = await client.query("SELECT * FROM recipes ORDER BY created_at ASC");

  console.log(
    `\nFound in Replit PostgreSQL: ${feedRes.rows.length} feed session(s), ` +
    `${bakeRes.rows.length} bake session(s), ${recipeRes.rows.length} recipe(s)\n`
  );

  // ── 3. Migrate feed_sessions ──────────────────────────────────────────────
  for (const row of feedRes.rows) {
    await sbFetch("/feed_sessions", {
      id: row.id,
      device_id: row.device_id,
      user_id: userId,
      saved_at: row.saved_at,
      started_at: row.started_at,
      data: row.data,
    });
    console.log(`  ✓ feed_session ${row.id}`);
  }

  // ── 4. Migrate bake_sessions ──────────────────────────────────────────────
  for (const row of bakeRes.rows) {
    await sbFetch("/bake_sessions", {
      id: row.id,
      device_id: row.device_id,
      user_id: userId,
      recipe_id: row.recipe_id,
      recipe_name: row.recipe_name,
      saved_at: row.saved_at,
      started_at: row.started_at,
      phases: row.phases,
      in_progress: row.in_progress,
    });
    console.log(`  ✓ bake_session ${row.id} (${row.recipe_name})`);
  }

  // ── 5. Migrate recipes ────────────────────────────────────────────────────
  for (const row of recipeRes.rows) {
    await sbFetch("/recipes", {
      id: row.id,
      device_id: row.device_id,
      user_id: userId,
      name: row.name,
      phases: row.phases,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
    console.log(`  ✓ recipe ${row.id} (${row.name})`);
  }

  await client.end();

  console.log(`
Done! All records are now in Supabase under user ID: ${userId}

Next step: open the app → History tab → account icon → "Find my data"
and enter "${firstName}" + "${starterName}" to link your device.
`);
}

main().catch((err) => {
  console.error("\nMigration failed:", err.message);
  process.exit(1);
});
