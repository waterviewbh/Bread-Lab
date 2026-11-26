import { bakeHistoryTimestamp } from "../recipeTypes";

describe("Bake History date semantics", () => {
  it("keeps the original completion date after review", () => {
    const archived = { completedAt: 100, savedAt: 200, outcome: null as unknown };
    const reviewed = { ...archived, outcome: { overallScore: 4 } };
    expect(bakeHistoryTimestamp(reviewed)).toBe(100);
  });

  it("uses the original archival date for legacy records without completedAt", () => {
    expect(bakeHistoryTimestamp({ savedAt: 200 })).toBe(200);
  });
});
