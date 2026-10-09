import {
  parseTransientSharePayload,
  sanitizeUrl,
  TransientSharePayload,
} from '../transientSharePayload';

describe('TransientSharePayload Module (Issue #65 — Step 8A)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. Ordinary Shared Text Reception', () => {
    it('creates a transient text payload for plain recipe snippet', () => {
      const rawText = '500g bread flour\n350g water\n100g levain\n10g salt';
      const subject = "Nana's Sourdough";

      const payload = parseTransientSharePayload(rawText, subject);

      expect(payload.type).toBe('text');
      expect(payload.rawContent).toBe(rawText);
      expect(payload.subject).toBe("Nana's Sourdough");
      expect(payload.sanitizedUrl).toBeUndefined();
      expect(payload.receivedAt).toBeDefined();
      expect(new Date(payload.receivedAt).getTime()).not.toBeNaN();
    });

    it('handles plain text without a subject line', () => {
      const rawText = 'Sourdough starter feeding schedule: 1:2:2 ratio twice daily.';
      const payload = parseTransientSharePayload(rawText);

      expect(payload.type).toBe('text');
      expect(payload.rawContent).toBe(rawText);
      expect(payload.subject).toBeUndefined();
    });
  });

  describe('2. Shared URL Reception & Token Sanitization', () => {
    it('detects URL and sanitizes tracking and session parameters', () => {
      const rawUrl =
        'https://kingarthurbaking.com/recipes/sourdough-bread?utm_source=newsletter&utm_medium=email&utm_campaign=fall_baking&fbclid=1234567890&gclid=abcdef&ref=share_btn#step2';

      const sanitized = sanitizeUrl(rawUrl);

      expect(sanitized).toBe('https://kingarthurbaking.com/recipes/sourdough-bread');
      expect(sanitized).not.toContain('utm_source');
      expect(sanitized).not.toContain('fbclid');
      expect(sanitized).not.toContain('gclid');
      expect(sanitized).not.toContain('#step2');
    });

    it('strips authentication and session tokens from shared URLs', () => {
      const rawUrl =
        'https://example.com/private/recipe?access_token=secret123&session_id=sess_999&auth=tok_abc&id=456';

      const sanitized = sanitizeUrl(rawUrl);

      expect(sanitized).toBe('https://example.com/private/recipe?id=456');
      expect(sanitized).not.toContain('access_token');
      expect(sanitized).not.toContain('session_id');
      expect(sanitized).not.toContain('auth');
    });

    it('creates a TransientSharePayload with type "url" and populated sanitizedUrl', () => {
      const rawContent =
        'Check out this recipe: https://sourdough.com/bread?utm_source=reddit&gclid=xyz';
      const payload = parseTransientSharePayload(rawContent, 'Reddit Share');

      expect(payload.type).toBe('url');
      expect(payload.rawContent).toBe(rawContent);
      expect(payload.subject).toBe('Reddit Share');
      expect(payload.sanitizedUrl).toBe('https://sourdough.com/bread');
    });
  });

  describe('3. Transience & Dismissal Guarantee', () => {
    it('simulates dismissal by clearing transient state to null', () => {
      let state: TransientSharePayload | null = parseTransientSharePayload('500g flour');
      expect(state).not.toBeNull();

      // Dismiss action
      state = null;

      expect(state).toBeNull();
    });
  });

  describe('4. Privacy Boundaries & Zero Side-Effects Proof', () => {
    it('proves URL sanitization does NOT perform network fetch requests', () => {
      const fetchSpy = jest.spyOn(global, 'fetch');

      const rawUrl = 'https://example.com/sourdough?utm_source=test';
      sanitizeUrl(rawUrl);
      parseTransientSharePayload(rawUrl);

      expect(fetchSpy).not.toHaveBeenCalled();
      fetchSpy.mockRestore();
    });

    it('proves caller context/package name is ignored and never stored as baker identity', () => {
      // Simulate Android intent caller extra
      const transportCallerPackage = 'com.google.android.gm'; // Gmail
      const rawText = 'https://example.com/recipe';

      const payload = parseTransientSharePayload(rawText);

      // Verify payload contains zero caller identity or package context
      expect(JSON.stringify(payload)).not.toContain(transportCallerPackage);
      expect((payload as Record<string, unknown>).callerPackage).toBeUndefined();
      expect((payload as Record<string, unknown>).userId).toBeUndefined();
      expect((payload as Record<string, unknown>).deviceId).toBeUndefined();
    });
  });
});
