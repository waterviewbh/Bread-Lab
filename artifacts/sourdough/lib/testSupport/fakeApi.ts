// artifacts/sourdough/lib/testSupport/fakeApi.ts
//
// TEST SUPPORT (not shipped behaviour). A small in-memory stand-in for the Supabase-backed `api`, used by the
// Omicron_CLI-4 import / transition tests. It stores rows in the same SHAPE the real endpoints persist
// (see lib/api.ts: recipes.upsert, history.bakes.upsert, history.feed.upsert) so read-back verification is
// exercised against realistic rows, and it has a switch for every failure mode the import must survive.
//
// Use from a test via:   jest.mock("../api", () => require("../testSupport/fakeApi").makeApiModule());
//                        import { fakeServer } from "../testSupport/fakeApi";

type Kind = "recipe" | "bake" | "feed";
type Row = Record<string, any>;

export interface FakeServer {
  tables: { recipe: Map<string, Row>; bake: Map<string, Row>; feed: Map<string, Row> };
  /** Names of every api function that was called, in order (for the NLA no-Supabase invariant). */
  calls: string[];
  /** Reject an upsert (for example RLS denial 42501). Return an Error to reject, or null to allow. */
  failUpsert: ((kind: Kind, body: any) => Error | null) | null;
  /** Resolve an upsert WITHOUT storing anything (a silently skipped record). */
  dropUpsert: ((kind: Kind, body: any) => boolean) | null;
  /** Alter a row after it was stored (a corrupted write). */
  corruptRow: ((kind: Kind, row: Row) => Row) | null;
  /** Force every stored row to be owned by someone else, or by nobody. */
  ownerOverride: ((kind: Kind, body: any) => string | null | undefined) | null;
  /** Make the read-back fail (network interruption). */
  fetchError: Error | null;
  /** Rewrite what the read-back returns (duplicate rows, extra rows, missing rows). */
  fetchTransform: ((kind: Kind, rows: Row[]) => Row[]) | null;
  reset(): void;
}

const makeTables = () => ({ recipe: new Map<string, Row>(), bake: new Map<string, Row>(), feed: new Map<string, Row>() });

export const fakeServer: FakeServer = {
  tables: makeTables(),
  calls: [],
  failUpsert: null,
  dropUpsert: null,
  corruptRow: null,
  ownerOverride: null,
  fetchError: null,
  fetchTransform: null,
  reset() {
    this.tables = makeTables();
    this.calls = [];
    this.failUpsert = null;
    this.dropUpsert = null;
    this.corruptRow = null;
    this.ownerOverride = null;
    this.fetchError = null;
    this.fetchTransform = null;
  },
};

const ownerFor = (kind: Kind, body: any): string | null => {
  if (fakeServer.ownerOverride) {
    const o = fakeServer.ownerOverride(kind, body);
    if (o !== undefined) return o;
  }
  return body.userId ?? null;
};

export function makeApiModule() {
  const actual = jest.requireActual("../api");
  const { packBakeOutcome } = actual;

  const note = (name: string) => fakeServer.calls.push(name);

  const store = (kind: Kind, body: any, row: Row) => {
    if (fakeServer.failUpsert) {
      const err = fakeServer.failUpsert(kind, body);
      if (err) return Promise.reject(err);
    }
    if (fakeServer.dropUpsert && fakeServer.dropUpsert(kind, body)) return Promise.resolve({});
    let r = row;
    if (fakeServer.corruptRow) r = fakeServer.corruptRow(kind, { ...row });
    fakeServer.tables[kind].set(body.id, r);
    return Promise.resolve({});
  };

  const api = {
    ...actual.api,
    auth: {
      ...actual.api.auth,
      signout: jest.fn(async () => { note("auth.signout"); return { signedOut: true }; }),
      getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
      identify: jest.fn(),
      linkDevice: jest.fn(async () => { note("auth.linkDevice"); }),
    },
    recipes: {
      upsert: jest.fn((body: any) => {
        note("recipes.upsert");
        return store("recipe", body, {
          id: body.id, device_id: body.deviceId, user_id: ownerFor("recipe", body), name: body.name,
          overview: body.overview ?? null, yield_value: body.yield_value, parent_recipe_id: body.parentRecipeId ?? null,
          recipe_data: JSON.parse(JSON.stringify(body)), is_archived: body.isArchived ?? false,
        });
      }),
      delete: jest.fn(async () => { note("recipes.delete"); return true; }),
      verifyAbsent: jest.fn(async () => { note("recipes.verifyAbsent"); return true; }),
      list: jest.fn(async () => { note("recipes.list"); return []; }),
      duplicate: jest.fn(async () => { note("recipes.duplicate"); return {}; }),
    },
    history: {
      bakes: {
        upsert: jest.fn((body: any) => {
          note("bakes.upsert");
          return store("bake", body, {
            id: body.id, device_id: body.deviceId, user_id: ownerFor("bake", body), recipe_id: body.recipeId ?? null,
            recipe_name: body.recipeName, yield_value: body.yield_value, saved_at: body.savedAt,
            started_at: body.startedAt, completed_at: body.completedAt ?? null, status: body.status ?? null,
            outcome: JSON.parse(JSON.stringify(packBakeOutcome(body.outcome, body.estimatorState, body.bulkCheckInHistory) ?? null)),
            notes: body.notes ?? null, phases: JSON.parse(JSON.stringify(body.phases ?? [])), in_progress: body.inProgress ?? true,
          });
        }),
        delete: jest.fn(async () => { note("bakes.delete"); return true; }),
        verifyAbsent: jest.fn(async () => { note("bakes.verifyAbsent"); return true; }),
        list: jest.fn(async () => { note("bakes.list"); return []; }),
        active: jest.fn(async () => { note("bakes.active"); return null; }),
      },
      feed: {
        upsert: jest.fn((body: any) => {
          note("feed.upsert");
          return store("feed", body, {
            id: body.id, device_id: body.deviceId, user_id: ownerFor("feed", body), saved_at: body.savedAt,
            started_at: body.startedAt ?? null, updated_at: body.updatedAt ?? null, in_progress: body.inProgress ?? false,
            data: JSON.parse(JSON.stringify(body.data ?? {})),
          });
        }),
        get: jest.fn(async () => { note("feed.get"); return null; }),
        active: jest.fn(async () => { note("feed.active"); return null; }),
        list: jest.fn(async () => { note("feed.list"); return []; }),
        delete: jest.fn(async () => { note("feed.delete"); return true; }),
        verifyAbsent: jest.fn(async () => { note("feed.verifyAbsent"); return true; }),
      },
    },
    fetchRowsByIds: jest.fn(async (kind: "recipes" | "bakes" | "feed", ids: string[], _ownerId: string) => {
      note("fetchRowsByIds");
      if (fakeServer.fetchError) throw fakeServer.fetchError;
      const k: Kind = kind === "recipes" ? "recipe" : kind === "bakes" ? "bake" : "feed";
      let rows: Row[] = ids.filter((id) => fakeServer.tables[k].has(id)).map((id) => ({ ...fakeServer.tables[k].get(id)! }));
      if (fakeServer.fetchTransform) rows = fakeServer.fetchTransform(k, rows);
      return { requested: ids.length, rows };
    }),
  };

  return { ...actual, api };
}
