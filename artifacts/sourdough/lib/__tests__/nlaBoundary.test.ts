import * as fs from "fs";
import * as path from "path";
import { NLA_SUPABASE_EXCEPTIONS, NLA_OWNER, isNlaOwner, NlaSupabaseBoundaryError } from "../nlaBoundary";

// STRUCTURAL enforcement of "NLA knows nothing about Supabase".
//
// This does not prove every path is safe by itself; it makes the set of places that can reach Supabase an explicit,
// reviewed list. Adding (or removing) a call site anywhere in the app fails this test until the list is updated
// deliberately, with a classification. The runtime tests (Feed tracker, tombstones, the sign-in screen) prove the
// behaviour of the paths that matter; the API layer refuses NLA for the four Feed endpoints (feedNlaBoundary.test.ts).

const sourceRoot = path.resolve(__dirname, "..", "..");
const SCAN_DIRS = ["app", "components", "lib", "hooks", "contexts"];

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === "node_modules" || e.name === "__tests__" || e.name === "testSupport" || e.name.startsWith(".")) return [];
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(e.name) && !/\.local\.test\./.test(e.name) ? [full] : [];
  });

const sources = SCAN_DIRS.map((d) => path.join(sourceRoot, d))
  .filter((d) => fs.existsSync(d))
  .flatMap(walk)
  .map((f) => ({ rel: path.relative(sourceRoot, f).split(path.sep).join("/"), text: fs.readFileSync(f, "utf8") }));

const stripComments = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** file -> sorted unique list of `api.<...>` functions it calls (outside lib/api.ts). */
const callSites = (): Record<string, string[]> => {
  const out: Record<string, string[]> = {};
  for (const { rel, text } of sources) {
    if (rel === "lib/api.ts") continue;
    const found = new Set<string>();
    for (const m of stripComments(text).matchAll(/\bapi\.((?:auth|recipes|history|analytics)(?:\.[A-Za-z]+)+|fetchRowsByIds)\s*\(/g)) {
      found.add(m[1]);
    }
    if (found.size) out[rel] = [...found].sort();
  }
  return out;
};

type Classification =
  | "feed-tracker-guarded"        // reachable by NLA but explicitly skipped for NLA before the call
  | "account-only"                // cannot run without an authenticated account
  | "auth-entry-exit"             // the sign-in / sign-out calls themselves (documented exception)
  | "import-under-session"        // Import and Proceed, under the destination account's session (documented exception)
  | "tombstone-processor"         // NLA branch retires locally; account branch unchanged
  | "scheduled-nla-reachable";    // KNOWN violation, reported in the CLI-4 inventory, scheduled for a later change

interface Expected { calls: string[]; classification: Classification; note: string }

const EXPECTED: Record<string, Expected> = {
  "components/AuthModal.tsx": { calls: ["auth.getSession", "auth.identify", "auth.signout"], classification: "auth-entry-exit", note: "how a baker leaves NLA" },
  "lib/transitionCoordinator.ts": { calls: ["auth.signout"], classification: "auth-entry-exit", note: "recovery" },
  "lib/remoteSessionGuard.ts": { calls: ["auth.getSession", "auth.signout"], classification: "auth-entry-exit", note: "closes a leftover remote session and confirms it; no data call" },
  "components/bench/ActiveFeedSection.tsx": { calls: ["history.feed.upsert"], classification: "feed-tracker-guarded", note: "finished-feed upload is skipped for NLA (isNlaOwner)" },
  "lib/nlaImport.ts": { calls: ["fetchRowsByIds"], classification: "import-under-session", note: "read-back under the destination account" },
  "lib/migrate.ts": { calls: ["history.bakes.upsert", "history.feed.upsert", "recipes.upsert"], classification: "account-only", note: "requires a destination token; used by Import and by account sync" },
  "components/recipe/CandidateReviewController.tsx": { calls: ["recipes.upsert"], classification: "account-only", note: "only when a user id exists" },
  "lib/recipeStorage.ts": {
    calls: [
      "history.bakes.active", "history.bakes.delete", "history.bakes.upsert", "history.bakes.verifyAbsent",
      "history.feed.delete", "history.feed.verifyAbsent", "recipes.delete", "recipes.list", "recipes.upsert", "recipes.verifyAbsent",
    ],
    classification: "tombstone-processor",
    note: "delete/verify: NLA branch makes no call (tested). Recipe/bake upserts and reads are SCHEDULED violations (inventory #5, #7, #8).",
  },
  // ── scheduled NLA-reachable violations (reported in the CLI-4 inventory; not remediated in this change) ──
  "app/(tabs)/history.tsx": { calls: ["auth.getSession", "history.bakes.list", "history.bakes.upsert", "history.feed.list", "history.feed.upsert"], classification: "scheduled-nla-reachable", note: "inventory #3/#4; feed list/upsert are refused by the API layer" },
  "components/log/log.tsx": { calls: ["history.bakes.list", "history.bakes.upsert", "history.feed.list", "history.feed.upsert"], classification: "scheduled-nla-reachable", note: "inventory #3/#4; feed list/upsert are refused by the API layer" },
  "app/(tabs)/recipe.tsx": { calls: ["recipes.upsert"], classification: "scheduled-nla-reachable", note: "inventory #5" },
  "components/lab/labHub.tsx": { calls: ["recipes.duplicate"], classification: "scheduled-nla-reachable", note: "inventory #6" },
  "components/log/logDiagnostic.tsx": { calls: ["recipes.duplicate"], classification: "scheduled-nla-reachable", note: "inventory #6" },
};

describe("NLA no-Supabase boundary (structural)", () => {
  it("every API call site in the app is on the reviewed list, and the list has no stale entries", () => {
    const actual = callSites();
    const expected = Object.fromEntries(Object.entries(EXPECTED).map(([f, e]) => [f, e.calls]));
    expect(actual).toEqual(expected);
  });

  it("every entry carries a recognised classification and a note", () => {
    const allowed = ["feed-tracker-guarded", "account-only", "auth-entry-exit", "import-under-session", "tombstone-processor", "scheduled-nla-reachable"];
    for (const [file, e] of Object.entries(EXPECTED)) {
      expect({ file, ok: allowed.includes(e.classification) && e.note.length > 5 }).toEqual({ file, ok: true });
    }
  });

  it("the Feed endpoints are the only ones the API layer refuses for NLA (matches the approved scope)", () => {
    const api = stripComments(fs.readFileSync(path.join(sourceRoot, "lib", "api.ts"), "utf8"));
    const refusals = [...api.matchAll(/new NlaSupabaseBoundaryError\("([^"]+)"\)/g)].map((m) => m[1]).sort();
    expect(refusals).toEqual(["fetchRowsByIds", "history.feed.active", "history.feed.get", "history.feed.list", "history.feed.upsert"]);
  });

  describe("the public-catalog exception is exactly what it claims to be", () => {
    const directClientUsers = () =>
      sources
        .filter(({ rel, text }) => !["lib/api.ts", "lib/supabase.ts"].includes(rel) && /\bsupabase\s*\n?\s*\.from\(|supabase\.auth|from\s+["'](@\/lib\/|\.\/)supabase["']/.test(stripComments(text)))
        .map(({ rel }) => rel)
        .sort();

    it("only the two catalog modules (and an unused import in migrate.ts) touch the Supabase client directly", () => {
      expect(directClientUsers()).toEqual(["lib/affiliateItems.ts", "lib/migrate.ts", "lib/scienceArticles.ts"]);
    });

    it("the catalog modules are read-only and only touch the two shared catalogs", () => {
      for (const rel of ["lib/affiliateItems.ts", "lib/scienceArticles.ts"]) {
        const text = stripComments(sources.find((s) => s.rel === rel)!.text);
        expect(text).not.toMatch(/\.(insert|upsert|update|delete)\s*\(/);
        const tables = [...text.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
        expect(tables.length).toBeGreaterThan(0);
        for (const t of tables) expect(["affiliate_items", "science_articles"]).toContain(t);
      }
    });

    it("migrate.ts does not actually use the client it imports", () => {
      const text = stripComments(sources.find((s) => s.rel === "lib/migrate.ts")!.text);
      const withoutImport = text.replace(/^import .*$/gm, "");
      expect(withoutImport).not.toMatch(/\bsupabase\b/); // imported, never referenced
    });

    it("the documented exceptions are exactly these three", () => {
      expect(NLA_SUPABASE_EXCEPTIONS.map((e) => e.id)).toEqual(["public-catalogs", "sign-in-and-sign-out", "import-under-destination-session"]);
    });
  });

  it("the NLA workspace modules never import the API or the Supabase client", () => {
    for (const rel of ["lib/nlaWorkspace.ts", "lib/nlaBoundary.ts", "lib/activeWork.ts"]) {
      const text = stripComments(sources.find((s) => s.rel === rel)!.text);
      expect(text).not.toMatch(/from\s+["'][^"']*\/(api|supabase)["']/);
    }
  });

  it("primitives behave", () => {
    expect(NLA_OWNER).toBe("anonymous");
    expect(isNlaOwner("anonymous")).toBe(true);
    expect(isNlaOwner("acct-1")).toBe(false);
    expect(isNlaOwner(null)).toBe(false);
    expect(new NlaSupabaseBoundaryError("x").message).toBe("NLA workspace must not communicate with Supabase (x).");
  });
});
