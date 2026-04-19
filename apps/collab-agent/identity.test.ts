import { describe, expect, test } from 'bun:test';
import { isAgentType, stripAdminFragment } from './identity';

describe('isAgentType', () => {
  test('accepts known types', () => {
    expect(isAgentType('claude')).toBe(true);
    expect(isAgentType('codex')).toBe(true);
    expect(isAgentType('opencode')).toBe(true);
    expect(isAgentType('junie')).toBe(true);
    expect(isAgentType('other')).toBe(true);
  });

  test('rejects unknown types', () => {
    expect(isAgentType('gpt')).toBe(false);
    expect(isAgentType('')).toBe(false);
    expect(isAgentType('CLAUDE')).toBe(false); // case-sensitive
  });
});

describe('stripAdminFragment', () => {
  test('removes admin param, preserves key', () => {
    const url = 'https://room.example.com/c/abc123#key=secret&admin=adminsecret';
    const result = stripAdminFragment(url);
    expect(result.stripped).toBe(true);
    expect(result.url).toBe('https://room.example.com/c/abc123#key=secret');
  });

  test('removes admin when it is the only fragment param (no trailing #)', () => {
    const url = 'https://room.example.com/c/abc123#admin=adminsecret';
    const result = stripAdminFragment(url);
    expect(result.stripped).toBe(true);
    expect(result.url).toBe('https://room.example.com/c/abc123');
  });

  test('passes through URLs without any fragment', () => {
    const url = 'https://room.example.com/c/abc123';
    const result = stripAdminFragment(url);
    expect(result.stripped).toBe(false);
    expect(result.url).toBe(url);
  });

  test('passes through URLs with fragment but no admin', () => {
    const url = 'https://room.example.com/c/abc123#key=secret&stripped=2';
    const result = stripAdminFragment(url);
    expect(result.stripped).toBe(false);
    expect(result.url).toBe(url);
  });

  test('preserves non-admin fragment params in order', () => {
    const url = 'https://room.example.com/c/abc#key=k&admin=a&name=alice&color=%23ff0000';
    const result = stripAdminFragment(url);
    expect(result.stripped).toBe(true);
    // URLSearchParams stringify preserves insertion order minus the deleted key.
    expect(result.url).toBe('https://room.example.com/c/abc#key=k&name=alice&color=%23ff0000');
  });
});
