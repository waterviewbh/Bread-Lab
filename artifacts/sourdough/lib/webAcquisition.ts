/**
 * Secure Web Content Acquisition Module (Issue #65 — Step 8B)
 *
 * NETWORK & SECURITY ISOLATION BOUNDARIES:
 * 1. Pre-fetch URL sanitization (stripping tracking params & auth tokens).
 * 2. Pre-fetch scheme validation (HTTP/HTTPS only).
 * 3. Pre-fetch private/loopback IP filter (rejects 127.0.0.1, 10.x, 172.16-31.x, 192.168.x, localhost).
 * 4. Timeout enforcement (8 seconds max via AbortController).
 * 5. Response size cap (2 MB max limit).
 * 6. Credential isolation (credentials: 'omit', zero auth headers).
 *
 * HONEST RUNTIME LIMITATION NOTE:
 * Standard JS `fetch` in React Native/browsers handles HTTP redirects transparently at the OS layer
 * without exposing post-redirect resolved IP addresses to JS code. Pre-fetch checks protect the initial
 * target URL, but post-redirect IP resolution cannot be intercepted in the JS runtime.
 */

import { sanitizeUrl } from './transientSharePayload';
import { extractRecipeFromHtml, ExtractionResult } from './recipeExtractor';
import { recordShareDiagnosticLog } from './shareDiagnostics';

const MAX_RESPONSE_SIZE_BYTES = 2 * 1024 * 1024; // 2 MB max cap
const FETCH_TIMEOUT_MS = 8000; // 8 seconds timeout

/**
 * Validates whether an IP address or hostname belongs to a private/loopback range.
 */
export function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase();

  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host === '0.0.0.0' ||
    host.endsWith('.local')
  ) {
    return true;
  }

  // IPv4 regex checks
  const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = host.match(ipv4Regex);
  if (match) {
    const octet1 = parseInt(match[1], 10);
    const octet2 = parseInt(match[2], 10);

    // 127.0.0.0/8 (Loopback)
    if (octet1 === 127) return true;
    // 10.0.0.0/8 (Private)
    if (octet1 === 10) return true;
    // 172.16.0.0/12 (Private: 172.16.0.0 - 172.31.255.255)
    if (octet1 === 172 && octet2 >= 16 && octet2 <= 31) return true;
    // 192.168.0.0/16 (Private)
    if (octet1 === 192 && octet2 === 168) return true;
    // 169.254.0.0/16 (Link-local)
    if (octet1 === 169 && octet2 === 254) return true;
    // 0.0.0.0/8
    if (octet1 === 0) return true;
  }

  return false;
}

/**
 * Fetches HTML content from a sanitized URL with strict security controls
 * and passes the body to extractRecipeFromHtml.
 */
export async function fetchAndExtractRecipeFromUrl(
  rawUrl: string,
  customFetch?: typeof fetch
): Promise<ExtractionResult> {
  const sanitizedUrl = sanitizeUrl(rawUrl);

  // 1. Scheme Validation
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(sanitizedUrl);
  } catch (_e) {
    return {
      status: 'security_rejected',
      reason: 'Malformed URL provided.',
      sourceUrl: rawUrl,
    };
  }

  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    return {
      status: 'security_rejected',
      reason: `Unsupported URL protocol '${parsedUrl.protocol}'. Only HTTP and HTTPS are permitted.`,
      sourceUrl: sanitizedUrl,
    };
  }

  // 2. Pre-Fetch Private IP & Loopback Filter (SSRF Protection)
  if (isPrivateOrLoopbackHost(parsedUrl.hostname)) {
    return {
      status: 'security_rejected',
      reason: `Access to private or loopback host '${parsedUrl.hostname}' is prohibited.`,
      sourceUrl: sanitizedUrl,
    };
  }

  // 3. Execution with Timeout, Size Caps, and Credential Isolation
  const fetchImpl = customFetch || fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetchImpl(sanitizedUrl, {
      method: 'GET',
      headers: {
        Accept: 'text/html, application/xhtml+xml, application/json',
        'User-Agent': 'BreadLab-Recipe-Import/1.0',
      },
      credentials: 'omit', // Zero cookies or ambient credentials
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const contentType = response.headers.get('content-type') || '';
    const contentLengthStr = response.headers.get('content-length');
    const contentLength = contentLengthStr ? parseInt(contentLengthStr, 10) : undefined;

    if (!response.ok) {
      const reason = `HTTP fetch failed with status ${response.status} ${response.statusText}.`;
      await recordShareDiagnosticLog('url_fetch_outcome', {
        detectedDomain: parsedUrl.hostname,
        httpStatus: response.status,
        contentType,
        fetchError: reason,
      });
      return {
        status: 'fetch_failed',
        reason,
        sourceUrl: sanitizedUrl,
      };
    }

    // 4. Content-Type Check
    if (
      !contentType.includes('text/html') &&
      !contentType.includes('application/xhtml+xml') &&
      !contentType.includes('application/json')
    ) {
      const reason = `Unsupported Content-Type '${contentType}'. Expected HTML or JSON.`;
      await recordShareDiagnosticLog('url_fetch_outcome', {
        detectedDomain: parsedUrl.hostname,
        httpStatus: response.status,
        contentType,
        fetchError: reason,
      });
      return {
        status: 'fetch_failed',
        reason,
        sourceUrl: sanitizedUrl,
      };
    }

    // 5. Response Size Limit Check
    if (contentLength && contentLength > MAX_RESPONSE_SIZE_BYTES) {
      const reason = `Response size (${contentLength} bytes) exceeds maximum limit of 2 MB.`;
      await recordShareDiagnosticLog('url_fetch_outcome', {
        detectedDomain: parsedUrl.hostname,
        httpStatus: response.status,
        contentType,
        payloadSizeBytes: contentLength,
        fetchError: reason,
      });
      return {
        status: 'security_rejected',
        reason,
        sourceUrl: sanitizedUrl,
      };
    }

    const htmlText = await response.text();
    if (htmlText.length > MAX_RESPONSE_SIZE_BYTES) {
      const reason = `Response payload size (${htmlText.length} bytes) exceeds maximum limit of 2 MB.`;
      await recordShareDiagnosticLog('url_fetch_outcome', {
        detectedDomain: parsedUrl.hostname,
        httpStatus: response.status,
        contentType,
        payloadSizeBytes: htmlText.length,
        fetchError: reason,
      });
      return {
        status: 'security_rejected',
        reason,
        sourceUrl: sanitizedUrl,
      };
    }

    await recordShareDiagnosticLog('url_fetch_outcome', {
      detectedDomain: parsedUrl.hostname,
      httpStatus: response.status,
      contentType,
      payloadSizeBytes: htmlText.length,
    });

    // 6. Pass HTML to pure extractor
    const extractionResult = extractRecipeFromHtml(htmlText, sanitizedUrl);

    await recordShareDiagnosticLog('extraction_result', {
      detectedDomain: parsedUrl.hostname,
      extractionStatus: extractionResult.status,
      candidateCount:
        extractionResult.status === 'single_candidate'
          ? 1
          : extractionResult.status === 'multiple_candidates'
          ? extractionResult.candidates.length
          : 0,
      rejectionReason:
        extractionResult.status === 'no_candidate' ? extractionResult.reason : undefined,
    });

    return extractionResult;
  } catch (error: any) {
    clearTimeout(timeoutId);
    const fetchError = error.name === 'AbortError'
      ? `HTTP request timed out after ${FETCH_TIMEOUT_MS / 1000} seconds.`
      : `Network fetch failed: ${error.message || 'Unknown network error'}.`;

    await recordShareDiagnosticLog('url_fetch_outcome', {
      detectedDomain: parsedUrl.hostname,
      fetchError,
    });

    return {
      status: 'fetch_failed',
      reason: fetchError,
      sourceUrl: sanitizedUrl,
    };
  }
}
