import { describe, expect, test } from 'bun:test';
import { corsHeaders, getAllowedOrigins, isLocalhostOrigin } from './cors';

describe('getAllowedOrigins', () => {
  test('returns defaults when no env value', () => {
    const origins = getAllowedOrigins();
    expect(origins).toEqual(['https://room.plannotator.ai']);
  });

  test('parses comma-separated env value', () => {
    const origins = getAllowedOrigins('https://a.com, https://b.com');
    expect(origins).toEqual(['https://a.com', 'https://b.com']);
  });
});

describe('isLocalhostOrigin', () => {
  test('matches http localhost with port', () => {
    expect(isLocalhostOrigin('http://localhost:3001')).toBe(true);
    expect(isLocalhostOrigin('http://localhost:57589')).toBe(true);
  });

  test('matches http localhost without port', () => {
    expect(isLocalhostOrigin('http://localhost')).toBe(true);
  });

  test('matches https localhost', () => {
    expect(isLocalhostOrigin('https://localhost:8443')).toBe(true);
  });

  test('matches 127.0.0.1 with port', () => {
    expect(isLocalhostOrigin('http://127.0.0.1:3001')).toBe(true);
  });

  test('matches [::1] with port', () => {
    expect(isLocalhostOrigin('http://[::1]:3001')).toBe(true);
  });

  test('matches 127.0.0.1 without port', () => {
    expect(isLocalhostOrigin('http://127.0.0.1')).toBe(true);
  });

  test('rejects non-localhost', () => {
    expect(isLocalhostOrigin('https://evil.com')).toBe(false);
    expect(isLocalhostOrigin('https://localhost.evil.com')).toBe(false);
    expect(isLocalhostOrigin('http://127.0.0.2:3001')).toBe(false);
  });
});

describe('corsHeaders', () => {
  const prodOrigins = ['https://room.plannotator.ai'];

  test('allows listed production origin', () => {
    const headers = corsHeaders('https://room.plannotator.ai', prodOrigins);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://room.plannotator.ai');
    expect(headers['Vary']).toBe('Origin');
  });

  test('localhost allowed when flag is true', () => {
    const headers = corsHeaders('http://localhost:57589', prodOrigins, true);
    expect(headers['Access-Control-Allow-Origin']).toBe('http://localhost:57589');
    expect(headers['Vary']).toBe('Origin');
  });

  test('localhost rejected when flag is false', () => {
    const headers = corsHeaders('http://localhost:57589', prodOrigins, false);
    expect(headers).toEqual({});
  });

  test('localhost rejected when flag is not provided', () => {
    const headers = corsHeaders('http://localhost:57589', prodOrigins);
    expect(headers).toEqual({});
  });

  test('rejects unlisted non-localhost origin', () => {
    const headers = corsHeaders('https://evil.example', prodOrigins, true);
    expect(headers).toEqual({});
  });

  test('allows any origin with wildcard', () => {
    const headers = corsHeaders('https://anything.com', ['*']);
    expect(headers['Access-Control-Allow-Origin']).toBe('https://anything.com');
    expect(headers['Vary']).toBe('Origin');
  });

  test('returns empty for no origin match', () => {
    const headers = corsHeaders('', prodOrigins);
    expect(headers).toEqual({});
  });

  test('all allowed responses include Vary: Origin', () => {
    const h1 = corsHeaders('https://room.plannotator.ai', prodOrigins);
    const h2 = corsHeaders('http://localhost:3001', prodOrigins, true);
    const h3 = corsHeaders('https://x.com', ['*']);
    expect(h1['Vary']).toBe('Origin');
    expect(h2['Vary']).toBe('Origin');
    expect(h3['Vary']).toBe('Origin');
  });
});
