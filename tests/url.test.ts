import { describe, expect, it } from 'vitest';
import { isTrackingParam, normalizeUrl } from '@/lib/url/normalize';
import { domainOf, extractUrls, trimUrlJunk } from '@/lib/url/extract';

describe('normalizeUrl', () => {
  it('lower-cases the scheme and host and drops the www prefix', () => {
    expect(normalizeUrl('HTTPS://WWW.Example.COM/Path')).toBe('https://example.com/Path');
  });

  it('removes a trailing slash on a bare path but keeps meaningful ones', () => {
    expect(normalizeUrl('https://example.com/')).toBe('https://example.com');
    expect(normalizeUrl('https://example.com/docs/')).toBe('https://example.com/docs/');
  });

  it('drops fragments, because they navigate inside the same document', () => {
    expect(normalizeUrl('https://example.com/guide#installation')).toBe('https://example.com/guide');
  });

  it('strips known telemetry parameters only', () => {
    expect(isTrackingParam('utm_source')).toBe(true);
    expect(isTrackingParam('fbclid')).toBe(true);
    expect(isTrackingParam('igshid')).toBe(true);
    expect(isTrackingParam('si')).toBe(true);
    expect(isTrackingParam('id')).toBe(false);
    expect(isTrackingParam('page')).toBe(false);
    expect(isTrackingParam('q')).toBe(false);
    expect(isTrackingParam('t')).toBe(false);
  });

  it('keeps parameters that may change the actual resource', () => {
    // A false "already saved" is worse than a rare duplicate, so anything
    // ambiguous survives normalisation.
    const normalized = normalizeUrl('https://shop.example.com/item?id=42&color=red&page=2&t=30');
    expect(normalized).toContain('id=42');
    expect(normalized).toContain('color=red');
    expect(normalized).toContain('page=2');
    expect(normalized).toContain('t=30');
  });

  it('sorts query parameters so reordered links still match', () => {
    const a = normalizeUrl('https://example.com/x?b=2&a=1');
    const b = normalizeUrl('https://example.com/x?a=1&b=2');
    expect(a).toBe(b);
  });

  it('removes default ports', () => {
    expect(normalizeUrl('https://example.com:443/x')).toBe('https://example.com/x');
    expect(normalizeUrl('http://example.com:80/x')).toBe('http://example.com/x');
  });

  describe('platform aliases', () => {
    it('canonicalises every YouTube video shape to one form', () => {
      const canonical = 'https://youtube.com/watch?v=dQw4w9WgXcQ';
      expect(normalizeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(canonical);
      expect(normalizeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toBe(canonical);
      expect(normalizeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ&si=abc123')).toBe(canonical);
      expect(normalizeUrl('https://youtube.com/embed/dQw4w9WgXcQ')).toBe(canonical);
      expect(normalizeUrl('https://youtube.com/live/dQw4w9WgXcQ')).toBe(canonical);
    });

    it('preserves playlist context alongside the video id', () => {
      expect(normalizeUrl('https://youtube.com/watch?v=a&list=PL1&feature=shared')).toBe(
        'https://youtube.com/watch?v=a&list=PL1',
      );
    });

    it('treats Instagram reels as reels', () => {
      expect(normalizeUrl('https://instagram.com/reels/ABC123/')).toBe('https://instagram.com/reel/ABC123');
    });

    it('maps twitter.com to x.com and old.reddit.com to reddit.com', () => {
      expect(normalizeUrl('https://twitter.com/user/status/1')).toBe('https://x.com/user/status/1');
      expect(normalizeUrl('https://old.reddit.com/r/webdev/comments/1')).toBe(
        'https://reddit.com/r/webdev/comments/1',
      );
    });
  });

  it('rejects everything that is not an absolute http(s) URL', () => {
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('intent://scan/#Intent;scheme=zxing;end')).toBeNull();
    expect(normalizeUrl('mailto:someone@example.com')).toBeNull();
    expect(normalizeUrl('not a url at all')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
  });
});

describe('extractUrls', () => {
  it('finds a bare URL', () => {
    expect(extractUrls('https://example.com/a').urls).toEqual(['https://example.com/a']);
  });

  it('finds a title followed by a URL on the next line', () => {
    const result = extractUrls('Binary Search Explained\nhttps://youtube.com/watch?v=abc');
    expect(result.urls).toEqual(['https://youtube.com/watch?v=abc']);
  });

  it('finds a URL embedded in prose', () => {
    const result = extractUrls('You should read this: https://example.com/post — it is great.');
    expect(result.urls).toEqual(['https://example.com/post']);
  });

  it('finds multiple URLs and de-duplicates aliases of the same resource', () => {
    const result = extractUrls(
      'https://youtu.be/abc and https://www.youtube.com/shorts/abc and https://example.com/x',
    );
    expect(result.urls).toHaveLength(2);
  });

  it('returns nothing for malformed or link-free content', () => {
    expect(extractUrls('').urls).toEqual([]);
    expect(extractUrls('just some words with no link').urls).toEqual([]);
    expect(extractUrls('node.js, e.g. this').urls).toEqual([]);
  });

  it('rejects non-http schemes that another app might share', () => {
    expect(extractUrls('javascript:void(0)').urls).toEqual([]);
  });

  it('accepts a bare domain when it carries a path, and makes it absolute', () => {
    expect(extractUrls('youtube.com/watch?v=abc').urls).toEqual(['https://youtube.com/watch?v=abc']);
  });

  it('trims sentence punctuation without eating query characters', () => {
    expect(trimUrlJunk('https://example.com/x?a=1).')).toBe('https://example.com/x?a=1');
    expect(trimUrlJunk('(https://example.com/x)')).toBe('https://example.com/x');
    expect(trimUrlJunk('https://example.com/path_(notes)')).toBe('https://example.com/path_(notes)');
  });
});

describe('domainOf', () => {
  it('drops the www prefix', () => {
    expect(domainOf('https://www.youtube.com/watch?v=1')).toBe('youtube.com');
  });

  it('returns an empty string for unusable input', () => {
    expect(domainOf('nonsense')).toBe('');
  });
});
