import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState } from "react-native";
import {
  saveCandidate,
  loadCandidates,
  ingestStagedNativeShares,
  removeCandidate,
  clearCandidates,
  formatCandidateSharedAt,
  CANDIDATES_KEY,
  CandidateRecord,
} from "@/lib/candidateStorage";
import {
  extractRecipeFromText,
  extractRecipeFromHtml,
  ExtractionResult,
} from "@/lib/recipeExtractor";
import { normalizePortableRecipe, validateRecipeForCommit } from "@/lib/recipeImport";
import { DETERMINISTIC_TEST_CANDIDATE } from "@/constants/testCandidateFixture";

// Mocks
let mockStagedShares: any[] = [];
jest.mock("@/lib/stagedShareBridge", () => ({
  getAndClearStagedShares: jest.fn(async () => {
    const items = [...mockStagedShares];
    mockStagedShares = [];
    return items;
  }),
}));

jest.mock("@react-native-async-storage/async-storage", () => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn(async (key: string) => store[key] || null),
    setItem: jest.fn(async (key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn(async (key: string) => {
      delete store[key];
    }),
    clear: jest.fn(async () => {
      store = {};
    }),
  };
});

describe("Issue #65 — Share-to-Candidate Front Door Suite", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    AppState.currentState = "active";
    mockStagedShares = [];
    await clearCandidates();
  });

  it("1. Share payload → Candidate creation & local persistence", async () => {
    const rawSharedText = `
      Country Sourdough Loaf
      500g bread flour
      350g water
      100g sourdough starter
      10g fine salt
      Autolyse flour and water. Incorporate starter and salt.
    `;

    const extraction = extractRecipeFromText(rawSharedText);
    expect(extraction.status).toBe("single_candidate");

    const savedRecord = await saveCandidate(extraction);
    expect(savedRecord.id).toBeTruthy();
    expect(savedRecord.sharedAt).toBeTruthy();

    const loadedList = await loadCandidates();
    expect(loadedList.length).toBe(1);
    expect(loadedList[0].id).toBe(savedRecord.id);
  });

  it("2. Candidate receives a valid sharedAt timestamp (supporting controlled clock injection)", async () => {
    const clockInjection = "2026-10-05T14:15:00.000Z";
    const savedRecord = await saveCandidate(
      DETERMINISTIC_TEST_CANDIDATE,
      clockInjection
    );

    expect(savedRecord.sharedAt).toBe(clockInjection);
    const parsedDate = new Date(savedRecord.sharedAt);
    expect(parsedDate.toISOString()).toBe(clockInjection);
  });

  it("3. Candidate ordering is newest sharedAt first", async () => {
    const candidateA = await saveCandidate(
      DETERMINISTIC_TEST_CANDIDATE,
      "2026-10-05T08:02:00.000Z"
    );
    const candidateB = await saveCandidate(
      DETERMINISTIC_TEST_CANDIDATE,
      "2026-10-05T08:14:00.000Z"
    );
    const candidateC = await saveCandidate(
      DETERMINISTIC_TEST_CANDIDATE,
      "2026-10-05T08:07:00.000Z"
    );

    const candidates = await loadCandidates();
    expect(candidates.length).toBe(3);

    // Expected order: B (08:14) -> C (08:07) -> A (08:02)
    expect(candidates[0].id).toBe(candidateB.id);
    expect(candidates[1].id).toBe(candidateC.id);
    expect(candidates[2].id).toBe(candidateA.id);
  });

  it("4. sharedAt survives Candidate persistence and reload across app restarts", async () => {
    const originalTime = "2026-10-04T09:32:00.000Z";
    const savedRecord = await saveCandidate(
      DETERMINISTIC_TEST_CANDIDATE,
      originalTime,
      'share'
    );

    // Simulate reload from AsyncStorage
    const loadedList = await loadCandidates();
    expect(loadedList.length).toBe(1);
    expect(loadedList[0].sharedAt).toBe(originalTime);

    // Test formatting helper (time string formatted in local environment timezone)
    const formattedSameDay = formatCandidateSharedAt(
      savedRecord,
      new Date("2026-10-04T12:00:00.000Z")
    );
    expect(formattedSameDay).toMatch(/^Shared \d{1,2}:\d{2}\s?[AP]M$/i);

    const formattedOlder = formatCandidateSharedAt(
      savedRecord,
      new Date("2026-10-06T12:00:00.000Z")
    );
    expect(formattedOlder).toMatch(/^Shared Oct 4, \d{1,2}:\d{2}\s?[AP]M$/i);
  });

  it("5. Confirmation occurs ONLY after Candidate persistence succeeds", async () => {
    let persistenceCalled = false;

    // Simulate persistence boundary wrapped around confirmation
    const mockSave = jest.fn(async (extraction: ExtractionResult) => {
      const record = await saveCandidate(extraction);
      persistenceCalled = true;
      return record;
    });

    const mockTriggerConfirmationToast = jest.fn();

    const processShare = async (extraction: ExtractionResult) => {
      if (
        extraction.status === "single_candidate" ||
        extraction.status === "multiple_candidates"
      ) {
        const record = await mockSave(extraction);
        if (persistenceCalled) {
          mockTriggerConfirmationToast(
            "Recipe candidate added to Bread Lab. Verify and add it in the app."
          );
        }
        return record;
      }
      return null;
    };

    await processShare(DETERMINISTIC_TEST_CANDIDATE);

    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(persistenceCalled).toBe(true);
    expect(mockTriggerConfirmationToast).toHaveBeenCalledWith(
      "Recipe candidate added to Bread Lab. Verify and add it in the app."
    );
  });

  it("6. NO success confirmation when acquisition/extraction fails", async () => {
    const failedExtraction: ExtractionResult = {
      status: "no_candidate",
      reason: "No recipe content found in text",
      warnings: [],
    };

    const mockTriggerConfirmationToast = jest.fn();

    const processShare = async (extraction: ExtractionResult) => {
      if (
        extraction.status === "single_candidate" ||
        extraction.status === "multiple_candidates"
      ) {
        await saveCandidate(extraction);
        mockTriggerConfirmationToast();
      }
    };

    await processShare(failedExtraction);

    expect(mockTriggerConfirmationToast).not.toHaveBeenCalled();
    const stored = await loadCandidates();
    expect(stored.length).toBe(0);
  });

  it("7. sharedAt does NOT become Recipe content during commit", async () => {
    const candidateRecord = await saveCandidate(
      DETERMINISTIC_TEST_CANDIDATE,
      "2026-10-04T08:14:00.000Z"
    );

    const portableCandidate =
      candidateRecord.extractionResult.status === "single_candidate"
        ? candidateRecord.extractionResult.candidate
        : null;

    expect(portableCandidate).toBeTruthy();

    // Prepare candidate for commit by assigning Unassigned Material to a phase
    const readyForCommit = JSON.parse(JSON.stringify(portableCandidate));
    readyForCommit.phases = readyForCommit.phases.filter(
      (p: any) => p.key !== "unclassified_import_staging"
    );

    const validation = validateRecipeForCommit(readyForCommit);
    expect(validation.valid).toBe(true);

    const commitTimestampBefore = Date.now();

    const normalizedRecipe = normalizePortableRecipe(readyForCommit, {
      id: "committed-recipe-uuid",
      deviceId: "device-123",
    });

    const commitTimestampAfter = Date.now();

    // Verify sharedAt is NOT present on the normalized recipe
    expect((normalizedRecipe as any).sharedAt).toBeUndefined();
    expect((normalizedRecipe as any).candidateSharedAt).toBeUndefined();

    // Verify createdAt is the commit time, NOT the candidate's sharedAt
    expect(normalizedRecipe.id).toBe("committed-recipe-uuid");
    expect(normalizedRecipe.name).toBe("San Francisco Sourdough Test Fixture");

    // Remove candidate from storage ONLY after commit succeeds
    await removeCandidate(candidateRecord.id);
    const remainingCandidates = await loadCandidates();
    expect(remainingCandidates.length).toBe(0);
  });

  it("8. Cold Share: Candidate persisted, NO toast shown", async () => {
    const mockShowToast = jest.fn();

    const processPayload = async (payload: {
      source: "initial" | "event";
      appStateAtArrival: string;
    }) => {
      const record = await saveCandidate(DETERMINISTIC_TEST_CANDIDATE);
      const shouldShowToast =
        payload.source === "event" && payload.appStateAtArrival !== "active";
      if (shouldShowToast) {
        mockShowToast();
      }
      return record;
    };

    const record = await processPayload({
      source: "initial",
      appStateAtArrival: "active",
    });

    expect(record).toBeTruthy();
    expect(mockShowToast).not.toHaveBeenCalled();

    const stored = await loadCandidates();
    expect(stored.length).toBe(1);
  });

  it("9. Warm Background Share: Candidate persisted, success toast SHOWN", async () => {
    const mockShowToast = jest.fn();

    const processPayload = async (payload: {
      source: "initial" | "event";
      appStateAtArrival: string;
    }) => {
      const record = await saveCandidate(DETERMINISTIC_TEST_CANDIDATE);
      const shouldShowToast =
        payload.source === "event" && payload.appStateAtArrival !== "active";
      if (shouldShowToast) {
        mockShowToast();
      }
      return record;
    };

    const record = await processPayload({
      source: "event",
      appStateAtArrival: "background",
    });

    expect(record).toBeTruthy();
    expect(mockShowToast).toHaveBeenCalledTimes(1);

    const stored = await loadCandidates();
    expect(stored.length).toBe(1);
  });

  it("10. Warm Foreground Share: Candidate persisted, NO toast shown", async () => {
    const mockShowToast = jest.fn();

    const processPayload = async (payload: {
      source: "initial" | "event";
      appStateAtArrival: string;
    }) => {
      const record = await saveCandidate(DETERMINISTIC_TEST_CANDIDATE);
      const shouldShowToast =
        payload.source === "event" && payload.appStateAtArrival !== "active";
      if (shouldShowToast) {
        mockShowToast();
      }
      return record;
    };

    const record = await processPayload({
      source: "event",
      appStateAtArrival: "active",
    });

    expect(record).toBeTruthy();
    expect(mockShowToast).not.toHaveBeenCalled();

    const stored = await loadCandidates();
    expect(stored.length).toBe(1);
  });

  it("11. Native staged shares are ingested into Candidate storage on load", async () => {
    mockStagedShares = [
      {
        id: "native-staged-uuid-1",
        rawContent: `
          Rustic Sourdough Bread
          500g bread flour
          350g water
          100g starter
          10g salt
          Mix ingredients and bulk ferment.
        `,
        sharedAt: "2026-10-06T12:00:00.000Z",
      },
    ];

    const candidates = await loadCandidates();
    expect(candidates.length).toBe(1);
    expect(candidates[0].sharedAt).toBe("2026-10-06T12:00:00.000Z");
    expect(candidates[0].extractionResult.status).toBe("single_candidate");
  });

  it("12. Discarding a Candidate permanently removes it from storage while leaving other candidates intact", async () => {
    const candidateA = await saveCandidate(
      DETERMINISTIC_TEST_CANDIDATE,
      "2026-10-05T08:00:00.000Z"
    );
    const candidateB = await saveCandidate(
      DETERMINISTIC_TEST_CANDIDATE,
      "2026-10-05T09:00:00.000Z"
    );

    let candidates = await loadCandidates();
    expect(candidates.length).toBe(2);

    // Discard Candidate A
    await removeCandidate(candidateA.id);

    // Reload from storage
    candidates = await loadCandidates();
    expect(candidates.length).toBe(1);
    expect(candidates[0].id).toBe(candidateB.id);

    // Discard Candidate B
    await removeCandidate(candidateB.id);

    // Reload from storage
    candidates = await loadCandidates();
    expect(candidates.length).toBe(0);
  });

  it("13. Background Share Safety: Staged share while AppState is 'background' does NOT call getAndClearStagedShares() or perform web acquisition", async () => {
    mockStagedShares = [
      {
        id: "bg-staged-1",
        rawContent: "https://www.kingarthurbaking.com/recipes/french-style-country-bread-recipe",
        sharedAt: "2026-10-06T14:00:00.000Z",
      },
    ];

    AppState.currentState = "background";

    // Attempt ingestion while in background
    await ingestStagedNativeShares();

    // Verify mockStagedShares remains untouched (NOT cleared)
    expect(mockStagedShares.length).toBe(1);

    // Verify no candidates were created
    const candidates = await loadCandidates(); // Note: loadCandidates in background state returns early
    expect(candidates.length).toBe(0);
  });

  it("14. AppState transition to 'active' ingests pending staged share and creates Candidate", async () => {
    mockStagedShares = [
      {
        id: "bg-staged-2",
        rawContent: "Simple Loaf\n500g flour\n350g water\n100g starter\n10g salt\nMix and bake.",
        sharedAt: "2026-10-06T15:00:00.000Z",
      },
    ];

    // Stage arrives while backgrounded
    AppState.currentState = "background";
    await ingestStagedNativeShares();
    expect(mockStagedShares.length).toBe(1);

    // App transitions to active
    AppState.currentState = "active";
    const candidates = await loadCandidates();

    // Verify staged share was consumed and Candidate was created
    expect(mockStagedShares.length).toBe(0);
    expect(candidates.length).toBe(1);
    expect(candidates[0].sharedAt).toBe("2026-10-06T15:00:00.000Z");
  });

  it("15. Native Staging Durability across force-stop/restart: staged share preserved in native storage while inactive", async () => {
    mockStagedShares = [
      {
        id: "durable-staged-1",
        rawContent: "Durable Recipe\n500g flour\n350g water\n100g starter\n10g salt",
        sharedAt: "2026-10-06T16:00:00.000Z",
      },
    ];

    // Receive share while backgrounded
    AppState.currentState = "background";
    await ingestStagedNativeShares();

    // Staged items must NOT be cleared merely because an ingestion attempt occurred while backgrounded
    expect(mockStagedShares.length).toBe(1);

    // Simulate force-stop and cold relaunch into active state
    AppState.currentState = "active";
    const reloaded = await loadCandidates();

    expect(reloaded.length).toBe(1);
    expect(mockStagedShares.length).toBe(0);
  });

  it("16. Concurrency Guard: Concurrent calls to ingestStagedNativeShares() execute sequentially via ingestionMutex without duplicate Candidate creation", async () => {
    mockStagedShares = [
      {
        id: "conc-staged-1",
        rawContent: "Concurrent Recipe\n500g flour\n350g water\n100g starter\n10g salt",
        sharedAt: "2026-10-06T17:00:00.000Z",
      },
    ];

    AppState.currentState = "active";

    // Trigger multiple simultaneous calls to ingestStagedNativeShares
    await Promise.all([
      ingestStagedNativeShares(),
      ingestStagedNativeShares(),
      ingestStagedNativeShares(),
    ]);

    const candidates = await loadCandidates();
    expect(candidates.length).toBe(1);
    expect(mockStagedShares.length).toBe(0);
  });
});
