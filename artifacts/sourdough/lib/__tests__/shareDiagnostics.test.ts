import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  recordShareDiagnosticLog,
  loadShareDiagnosticLogs,
  clearShareDiagnosticLogs,
  SHARE_DIAG_LOGS_KEY,
} from '@/lib/shareDiagnostics';

jest.mock('@react-native-async-storage/async-storage', () => {
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

describe('Share Acquisition Diagnostics Suite', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await clearShareDiagnosticLogs();
  });

  it('1. Records diagnostic logs across acquisition stages', async () => {
    await recordShareDiagnosticLog('native_intent_receipt', {
      source: 'native_staging',
      action: 'android.intent.action.SEND',
      hasExtraText: true,
      extraTextLength: 75,
      hasSubject: true,
      subjectLength: 15,
      stagedId: 'uuid-1',
    });

    await recordShareDiagnosticLog('url_classification', {
      source: 'native_staging',
      stagedId: 'uuid-1',
      isUrlDetected: true,
      detectedDomain: 'www.reddit.com',
    });

    await recordShareDiagnosticLog('candidate_persistence_decision', {
      source: 'native_staging',
      stagedId: 'uuid-1',
      persistenceDecision: 'rejected_no_candidate',
      rejectionReason: 'No structured Schema.org Recipe JSON-LD or Microdata found in HTML.',
    });

    const logs = await loadShareDiagnosticLogs();
    expect(logs.length).toBe(3);

    // Newest log first
    expect(logs[0].stage).toBe('candidate_persistence_decision');
    expect(logs[0].details.persistenceDecision).toBe('rejected_no_candidate');

    expect(logs[1].stage).toBe('url_classification');
    expect(logs[1].details.detectedDomain).toBe('www.reddit.com');

    expect(logs[2].stage).toBe('native_intent_receipt');
    expect(logs[2].details.action).toBe('android.intent.action.SEND');
  });

  it('2. Enforces maximum diagnostic log cap', async () => {
    for (let i = 0; i < 110; i++) {
      await recordShareDiagnosticLog('url_classification', {
        extraTextLength: i,
      });
    }

    const logs = await loadShareDiagnosticLogs();
    expect(logs.length).toBe(100);
  });

  it('3. Clears diagnostic logs cleanly', async () => {
    await recordShareDiagnosticLog('js_ingestion_start', { candidateCount: 2 });
    let logs = await loadShareDiagnosticLogs();
    expect(logs.length).toBe(1);

    await clearShareDiagnosticLogs();
    logs = await loadShareDiagnosticLogs();
    expect(logs.length).toBe(0);
  });
});
