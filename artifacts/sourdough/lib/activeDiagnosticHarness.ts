import { fetchAndExtractRecipeFromUrl } from './webAcquisition';
import { recordShareDiagnosticLog } from './shareDiagnostics';

const TARGET_URL = 'https://www.kingarthurbaking.com/recipes/the-easiest-loaf-of-bread-youll-ever-bake-recipe';

export interface DiagnosticAttemptResult {
  requestNumber: number;
  startTimestamp: string;
  endTimestamp: string;
  elapsedMs: number;
  success: boolean;
  httpStatus?: number;
  contentType?: string;
  payloadSizeBytes?: number;
  errorOrReason?: string;
  extractionResultStatus?: string;
  candidateName?: string;
}

let harnessRunning = false;
let cancelRequested = false;

/**
 * Flags the harness to cancel further request iterations cleanly
 * without shutting down or restarting the app session.
 */
export function stopActiveSessionDiagnostic() {
  if (harnessRunning) {
    cancelRequested = true;
    console.log('[ActiveDiagHarness] Cancellation requested by user.');
  }
}

/**
 * Executes a controlled 4-request sequential diagnostic test against TARGET_URL
 * while Bread Lab is active in the foreground.
 */
export async function runActiveSessionDiagnostic(): Promise<DiagnosticAttemptResult[]> {
  if (harnessRunning) {
    console.log('[ActiveDiagHarness] Harness already running, skipping duplicate call.');
    return [];
  }

  harnessRunning = true;
  cancelRequested = false;
  console.log('[ActiveDiagHarness] Starting 4-request sequential diagnostic harness for:', TARGET_URL);
  const results: DiagnosticAttemptResult[] = [];

  for (let i = 1; i <= 4; i++) {
    if (cancelRequested) {
      console.log(`[ActiveDiagHarness] Cancellation acknowledged before Request ${i}/4. Breaking loop.`);
      break;
    }

    const startIso = new Date().toISOString();
    const startTime = Date.now();

    console.log(`[ActiveDiagHarness] Starting Request ${i}/4 at ${startIso}...`);

    let extractionResult: any = null;
    let thrownErrorMsg: string | undefined = undefined;

    try {
      extractionResult = await fetchAndExtractRecipeFromUrl(TARGET_URL);
    } catch (err: any) {
      thrownErrorMsg = err?.message || String(err);
    }

    const endTime = Date.now();
    const endIso = new Date().toISOString();
    const elapsedMs = endTime - startTime;

    const isSuccess =
      extractionResult?.status === 'single_candidate' ||
      extractionResult?.status === 'multiple_candidates';

    const failureReason =
      extractionResult?.status === 'fetch_failed' || extractionResult?.status === 'security_rejected' || extractionResult?.status === 'no_candidate'
        ? extractionResult.reason
        : thrownErrorMsg;

    const candidateName =
      extractionResult?.status === 'single_candidate'
        ? extractionResult.candidate.name
        : extractionResult?.status === 'multiple_candidates'
        ? extractionResult.candidates[0]?.name
        : undefined;

    const record: DiagnosticAttemptResult = {
      requestNumber: i,
      startTimestamp: startIso,
      endTimestamp: endIso,
      elapsedMs,
      success: isSuccess,
      errorOrReason: failureReason,
      extractionResultStatus: extractionResult?.status || 'error',
      candidateName,
    };

    results.push(record);

    await recordShareDiagnosticLog('url_fetch_outcome', {
      source: 'active_session_harness',
      detectedDomain: 'www.kingarthurbaking.com',
      diagAttemptNumber: i,
      targetUrl: TARGET_URL,
      startIso,
      endIso,
      elapsedMs,
      isSuccess,
      extractionStatus: extractionResult?.status,
      fetchError: failureReason,
      candidateName,
    });

    console.log(`[ActiveDiagHarness] Completed Request ${i}/4 in ${elapsedMs}ms:`, JSON.stringify(record));

    if (i < 4) {
      console.log(`[ActiveDiagHarness] Waiting 20 seconds before Request ${i + 1}/4...`);
      for (let delayMs = 0; delayMs < 20000; delayMs += 500) {
        if (cancelRequested) {
          console.log('[ActiveDiagHarness] Cancellation detected during 20s delay. Breaking loop.');
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  harnessRunning = false;
  console.log('[ActiveDiagHarness] Diagnostic Harness Finished. Results:\n', JSON.stringify(results, null, 2));
  return results;
}
