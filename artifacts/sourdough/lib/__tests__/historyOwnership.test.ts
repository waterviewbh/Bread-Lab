// artifacts/sourdough/lib/__tests__/historyOwnership.test.ts
import { api } from "../api";
import { supabase } from "../supabase";
import { isOwnerMatch } from "../../app/(tabs)/history";

const mockBakesChain = {
  order: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  returns: jest.fn().mockResolvedValue({
    data: [
      {
        id: "luke-bake-1",
        device_id: "dev-1",
        user_id: "luke-token-123",
        recipe_id: "luke-recipe-1",
        recipe_name: "Luke's Country Sourdough",
        saved_at: 1700000000000,
        started_at: 1700000000000,
        phases: [],
        in_progress: false,
        created_at: "2023-11-14T22:13:20.000Z",
        yield_value: 1,
        completed_at: null,
        status: "completed",
        outcome: null,
        notes: null,
      },
    ],
    error: null,
  }),
};

const mockFeedChain = {
  order: jest.fn().mockReturnThis(),
  eq: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  returns: jest.fn().mockResolvedValue({
    data: [
      {
        id: "luke-feed-1",
        device_id: "dev-1",
        user_id: "luke-token-123",
        saved_at: 1700000000000,
        started_at: 1700000000000,
        updated_at: 1700000000000,
        in_progress: false,
        data: { initialPH: "4.2", starterWeight: "50" },
        created_at: "2023-11-14T22:13:20.000Z",
      },
    ],
    error: null,
  }),
};

const mockOr = jest.fn().mockImplementation((filter: string) => {
  if (filter.includes("user_id.eq.luke-token-123")) {
    return mockBakesChain;
  }
  return {
    order: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    returns: jest.fn().mockResolvedValue({ data: [], error: null }),
  };
});

jest.mock("../supabase", () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
    },
    from: jest.fn().mockImplementation((table: string) => ({
      select: jest.fn().mockReturnValue({
        or: mockOr,
      }),
    })),
  },
}));

describe("History Ownership Isolation Regression", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("queries history strictly scoped to the authenticated user ID without leaking other users' records", async () => {
    const lukeBakes = await api.history.bakes.list("shared-dev", "luke-token-123");
    expect(lukeBakes).toHaveLength(1);
    expect(lukeBakes[0].recipeName).toBe("Luke's Country Sourdough");
    expect(mockOr).toHaveBeenCalledWith("user_id.eq.luke-token-123");
  });

  it("filters out Padme's local history entries when querying for Luke using production isOwnerMatch predicate", () => {
    const padmeBake = { id: "padme-bake-1", userId: "padme-token-999", recipeName: "Yum Food" };
    const lukeBake = { id: "luke-bake-1", userId: "luke-token-123", recipeName: "Luke Sourdough" };
    const anonBake = { id: "anon-bake-1", userId: "anonymous", recipeName: "Anon Sourdough" };
    const localEntries = [padmeBake, lukeBake, anonBake];

    const filteredForLuke = localEntries.filter((b) => isOwnerMatch(b, "luke-token-123"));

    expect(filteredForLuke).toHaveLength(1);
    expect(filteredForLuke[0].id).toBe("luke-bake-1");
    expect(filteredForLuke[0].recipeName).toBe("Luke Sourdough");
    expect(filteredForLuke.some((b) => b.userId === "padme-token-999")).toBe(false);
    expect(filteredForLuke.some((b) => b.userId === "anonymous")).toBe(false);
  });
});
