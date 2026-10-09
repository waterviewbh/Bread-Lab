import {
  fetchAndExtractRecipeFromUrl,
  isPrivateOrLoopbackHost,
} from '../webAcquisition';

describe('Web Content Acquisition Security Module (Issue #65 — Step 8B)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('1. SSRF & Private Network IP Protection', () => {
    it('correctly identifies loopback and private IP hostnames', () => {
      expect(isPrivateOrLoopbackHost('localhost')).toBe(true);
      expect(isPrivateOrLoopbackHost('127.0.0.1')).toBe(true);
      expect(isPrivateOrLoopbackHost('127.0.0.5')).toBe(true);
      expect(isPrivateOrLoopbackHost('::1')).toBe(true);
      expect(isPrivateOrLoopbackHost('10.0.0.1')).toBe(true);
      expect(isPrivateOrLoopbackHost('10.255.255.255')).toBe(true);
      expect(isPrivateOrLoopbackHost('172.16.0.1')).toBe(true);
      expect(isPrivateOrLoopbackHost('172.31.255.255')).toBe(true);
      expect(isPrivateOrLoopbackHost('192.168.1.1')).toBe(true);
      expect(isPrivateOrLoopbackHost('169.254.169.254')).toBe(true); // AWS IMDS
      expect(isPrivateOrLoopbackHost('server.local')).toBe(true);

      // Public domains must pass
      expect(isPrivateOrLoopbackHost('kingarthurbaking.com')).toBe(false);
      expect(isPrivateOrLoopbackHost('8.8.8.8')).toBe(false);
    });

    it('rejects pre-fetch attempts to private/loopback hosts with status "security_rejected"', async () => {
      const mockFetch = jest.fn();

      const result = await fetchAndExtractRecipeFromUrl('http://127.0.0.1:8080/recipe', mockFetch as any);

      expect(result.status).toBe('security_rejected');
      if (result.status === 'security_rejected') {
        expect(result.reason).toContain('prohibited');
      }
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('2. Scheme & Protocol Restrictions', () => {
    it('rejects unsupported URL schemes like file:// or ftp://', async () => {
      const mockFetch = jest.fn();

      const result = await fetchAndExtractRecipeFromUrl('file:///etc/passwd', mockFetch as any);

      expect(result.status).toBe('security_rejected');
      if (result.status === 'security_rejected') {
        expect(result.reason).toContain('Unsupported URL protocol');
      }
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe('3. Credential Isolation & Pre-Fetch Parameter Sanitization', () => {
    it('strips tracking/auth query parameters prior to issuing fetch and enforces credentials: omit', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: { get: (h: string) => (h === 'content-type' ? 'text/html' : null) },
        text: async () => `<script type="application/ld+json">{"@type":"Recipe","name":"Sanitized Loaf","recipeIngredient":["flour"]}</script>`,
      });

      const rawUrl = 'https://example.com/recipe?utm_source=email&access_token=secret123&session_id=999';
      const result = await fetchAndExtractRecipeFromUrl(rawUrl, mockFetch as any);

      expect(result.status).toBe('single_candidate');
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const [calledUrl, fetchOpts] = mockFetch.mock.calls[0];
      expect(calledUrl).toBe('https://example.com/recipe');
      expect(calledUrl).not.toContain('utm_source');
      expect(calledUrl).not.toContain('access_token');
      expect(fetchOpts.credentials).toBe('omit');
    });
  });

  describe('4. Response Size Limits & Timeout Enforcement', () => {
    it('rejects responses that exceed maximum 2 MB size cap', async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: (h: string) => {
            if (h === 'content-type') return 'text/html';
            if (h === 'content-length') return '3145728'; // 3 MB
            return null;
          },
        },
        text: async () => 'huge html content',
      });

      const result = await fetchAndExtractRecipeFromUrl('https://example.com/big-page', mockFetch as any);

      expect(result.status).toBe('security_rejected');
      if (result.status === 'security_rejected') {
        expect(result.reason).toContain('exceeds maximum limit of 2 MB');
      }
    });

    it('returns "fetch_failed" on HTTP timeout or abort', async () => {
      const mockFetch = jest.fn().mockImplementation(() => {
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });

      const result = await fetchAndExtractRecipeFromUrl('https://example.com/slow-page', mockFetch as any);

      expect(result.status).toBe('fetch_failed');
      if (result.status === 'fetch_failed') {
        expect(result.reason).toContain('timed out');
      }
    });
  });
});
