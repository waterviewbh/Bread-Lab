import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  saveCandidate,
  loadCandidates,
  updateCandidateExtraction,
  removeCandidate,
  getCandidatesKey,
  ANONYMOUS_CANDIDATES_KEY,
  LEGACY_GLOBAL_CANDIDATES_KEY,
} from '../candidateStorage';
import { saveAuth, clearAuth } from '../auth';
import { ExtractionResult } from '../recipeExtractor';

describe('Candidate Data Isolation & Account-Scoped Persistence', () => {
  const mockExtraction: ExtractionResult = {
    status: 'single_candidate',
    sourceUrl: 'https://example.com/sourdough',
    warnings: [],
    candidate: {
      schemaVersion: '1.0',
      name: 'Test Loaf',
      phases: [],
    },
  };

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  afterEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  it('1. Unauthenticated Candidate creation and loading uses anonymous namespace', async () => {
    await clearAuth();
    const key = await getCandidatesKey();
    expect(key).toBe(ANONYMOUS_CANDIDATES_KEY);

    await saveCandidate(mockExtraction);
    const candidates = await loadCandidates();
    expect(candidates.length).toBe(1);
    expect(candidates[0].extractionResult.candidate.name).toBe('Test Loaf');
  });

  it('2. Account A candidate is absent when Account B logs in (Account isolation)', async () => {
    // ── Log in as User A ──
    await saveAuth('user-a', { id: 'user-a', firstName: 'Alice', starterName: 'Levain A' });
    const keyA = await getCandidatesKey();
    expect(keyA).toBe('bread_lab_candidates_v1_user-a');

    await saveCandidate(mockExtraction);
    const candidatesA = await loadCandidates();
    expect(candidatesA.length).toBe(1);

    // ── Logout A, Login B ──
    await clearAuth();
    await saveAuth('user-b', { id: 'user-b', firstName: 'Bob', starterName: 'Levain B' });
    const keyB = await getCandidatesKey();
    expect(keyB).toBe('bread_lab_candidates_v1_user-b');

    const candidatesB = await loadCandidates();
    expect(candidatesB.length).toBe(0); // User B cannot see User A's candidates
  });

  it('3. Logout/login restores the correct account candidate namespace', async () => {
    // User A creates candidate
    await saveAuth('user-a', { id: 'user-a', firstName: 'Alice', starterName: 'Levain A' });
    await saveCandidate(mockExtraction);
    expect((await loadCandidates()).length).toBe(1);

    // Logout A
    await clearAuth();
    expect((await loadCandidates()).length).toBe(0); // unauthenticated sees anonymous (empty)

    // Log back in as User A
    await saveAuth('user-a', { id: 'user-a', firstName: 'Alice', starterName: 'Levain A' });
    const restoredA = await loadCandidates();
    expect(restoredA.length).toBe(1); // User A's candidate is fully restored
    expect(restoredA[0].extractionResult.candidate.name).toBe('Test Loaf');
  });

  it('4. Account operations (edit, remove) do not affect other accounts', async () => {
    // User A creates candidate
    await saveAuth('user-a', { id: 'user-a', firstName: 'Alice', starterName: 'Levain A' });
    const recA = await saveCandidate(mockExtraction);

    // User B logs in, creates own candidate
    await clearAuth();
    await saveAuth('user-b', { id: 'user-b', firstName: 'Bob', starterName: 'Levain B' });
    const recB = await saveCandidate({
      status: 'single_candidate',
      warnings: [],
      candidate: { schemaVersion: '1.0', name: 'Bob Loaf', phases: [] },
    });

    expect((await loadCandidates()).length).toBe(1);
    expect((await loadCandidates())[0].extractionResult.candidate.name).toBe('Bob Loaf');

    // User B removes their candidate
    await removeCandidate(recB.id);
    expect((await loadCandidates()).length).toBe(0);

    // User A logs back in, User A's candidate remains untouched
    await clearAuth();
    await saveAuth('user-a', { id: 'user-a', firstName: 'Alice', starterName: 'Levain A' });
    const candidatesA = await loadCandidates();
    expect(candidatesA.length).toBe(1);
    expect(candidatesA[0].id).toBe(recA.id);
  });

  it('5. Legacy global data migration is conservative and happens once into anonymous bucket', async () => {
    // Seed legacy global key
    const legacyRecord = {
      id: 'legacy-1',
      sharedAt: new Date().toISOString(),
      extractionResult: mockExtraction,
    };
    await AsyncStorage.setItem(LEGACY_GLOBAL_CANDIDATES_KEY, JSON.stringify([legacyRecord]));

    // Authenticate as User A
    await saveAuth('user-a', { id: 'user-a', firstName: 'Alice', starterName: 'Levain A' });

    // User A loads candidates — legacy data should NOT be silently attributed to User A
    const candidatesA = await loadCandidates();
    expect(candidatesA.length).toBe(0);

    // Clear auth to check anonymous bucket where legacy data was conservatively migrated
    await clearAuth();
    const anonCandidates = await loadCandidates();
    expect(anonCandidates.length).toBe(1);
    expect(anonCandidates[0].id).toBe('legacy-1');

    // Verify global legacy key was removed (migration happens only once)
    expect(await AsyncStorage.getItem(LEGACY_GLOBAL_CANDIDATES_KEY)).toBeNull();
  });

  it('6. Invalid or mismatched identity pair causes loadCandidates() to reject instead of returning []', async () => {
    const authModule = require('../auth');
    jest.spyOn(authModule, 'getStoredToken').mockRejectedValue(new Error('Identity integrity failure: token and profile IDs differ'));

    await expect(loadCandidates()).rejects.toThrow(/Identity integrity failure/);
  });

  it('7. loadCandidates validates identity before migration or ingestion and performs zero candidate storage reads/writes on identity failure', async () => {
    const authModule = require('../auth');
    const integrityError = new Error('Identity integrity failure: token and profile IDs differ');
    jest.spyOn(authModule, 'getStoredToken').mockRejectedValue(integrityError);

    const getItemSpy = jest.spyOn(AsyncStorage, 'getItem');
    const setItemSpy = jest.spyOn(AsyncStorage, 'setItem');

    getItemSpy.mockClear();
    setItemSpy.mockClear();

    await expect(loadCandidates()).rejects.toThrow(integrityError);

    const calls = getItemSpy.mock.calls.map(call => call[0]);
    for (const key of calls) {
      expect(key).not.toContain('candidates');
    }
    expect(setItemSpy).not.toHaveBeenCalled();
  });
});
