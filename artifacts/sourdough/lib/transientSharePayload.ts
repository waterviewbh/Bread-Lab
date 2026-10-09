import { AppStateStatus } from 'react-native';

export interface TransientSharePayload {
  type: 'text' | 'url';
  rawContent: string;
  subject?: string;
  sanitizedUrl?: string; // Populated if type === 'url' after stripping tracking & auth tokens
  receivedAt: string;    // ISO 8601 timestamp
  source?: 'initial' | 'event';
  appStateAtArrival?: AppStateStatus;
}

/**
 * Parameters that MUST be stripped from URLs to preserve privacy.
 */
const TRACKING_AND_AUTH_PARAMS = new Set([
  // Marketing & tracking
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'fbclid',
  'gclid',
  'msclkid',
  'ref',
  'mc_eid',
  '_ga',
  // Session & authentication tokens
  'access_token',
  'auth',
  'token',
  'session_id',
  'sid',
  'key',
  'api_key',
  'phpsessid',
]);

/**
 * Local string processing function to sanitize URLs by stripping tracking and session tokens.
 * GUARANTEE: Pure string manipulation. Performs ZERO network calls.
 */
export function sanitizeUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr.trim());

    // Strip hash fragment
    url.hash = '';

    // Strip known tracking and authentication query parameters
    const params = new URLSearchParams(url.search);
    const keysToDelete: string[] = [];
    params.forEach((_, key) => {
      if (TRACKING_AND_AUTH_PARAMS.has(key.toLowerCase())) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach((key) => params.delete(key));
    url.search = params.toString();

    return url.toString();
  } catch (_e) {
    // If URL parsing fails, return trimmed original input without failing
    return urlStr.trim();
  }
}

/**
 * Regular expression to detect http/https URLs in text.
 */
const URL_REGEX = /(https?:\/\/[^\s]+)/i;

/**
 * Pure helper function to convert raw ACTION_SEND extra text/subject into a TransientSharePayload.
 */
export function parseTransientSharePayload(
  rawInput: string,
  subject?: string,
  options?: {
    source?: 'initial' | 'event';
    appStateAtArrival?: AppStateStatus;
  }
): TransientSharePayload {
  const trimmed = (rawInput || '').trim();
  const match = trimmed.match(URL_REGEX);

  const timestamp = new Date().toISOString();
  const source = options?.source ?? 'initial';
  const appStateAtArrival = options?.appStateAtArrival ?? 'active';

  if (match) {
    const rawUrl = match[1];
    const sanitized = sanitizeUrl(rawUrl);
    return {
      type: 'url',
      rawContent: trimmed,
      subject: subject ? subject.trim() : undefined,
      sanitizedUrl: sanitized,
      receivedAt: timestamp,
      source,
      appStateAtArrival,
    };
  }

  return {
    type: 'text',
    rawContent: trimmed,
    subject: subject ? subject.trim() : undefined,
    receivedAt: timestamp,
    source,
    appStateAtArrival,
  };
}
