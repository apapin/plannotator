import { describe, expect, test } from 'bun:test';
import {
  AGENT_TYPES,
  constructAgentIdentity,
  getAgentType,
  InvalidAgentIdentityError,
  isAgentIdentity,
} from './agentIdentity';

describe('isAgentIdentity', () => {
  test('true for canonical forms', () => {
    expect(isAgentIdentity('alice-agent-claude')).toBe(true);
    expect(isAgentIdentity('swift-falcon-tater-agent-codex')).toBe(true);
    expect(isAgentIdentity('user123-agent-opencode')).toBe(true);
    expect(isAgentIdentity('multi-dash-user-agent-junie')).toBe(true);
    expect(isAgentIdentity('something-agent-other')).toBe(true);
  });

  test('false for plain human identities', () => {
    expect(isAgentIdentity('alice')).toBe(false);
    expect(isAgentIdentity('swift-falcon-tater')).toBe(false);
    expect(isAgentIdentity('Free Agent')).toBe(false);
    expect(isAgentIdentity('agent-of-chaos')).toBe(false);
  });

  test('false for unknown suffix types', () => {
    expect(isAgentIdentity('alice-agent-gpt')).toBe(false);
    expect(isAgentIdentity('bob-agent-')).toBe(false);
  });

  test('false for empty / null / non-string', () => {
    expect(isAgentIdentity('')).toBe(false);
    expect(isAgentIdentity(null)).toBe(false);
    expect(isAgentIdentity(undefined)).toBe(false);
    expect(isAgentIdentity(42 as unknown as string)).toBe(false);
  });

  test('case-sensitive: uppercase suffix does not match', () => {
    // Rationale: identities round-trip through constructAgentIdentity
    // which lowercases. A human whose name contains "Agent" shouldn't
    // accidentally false-positive.
    expect(isAgentIdentity('alice-agent-Claude')).toBe(false);
    expect(isAgentIdentity('alice-AGENT-claude')).toBe(false);
  });
});

describe('getAgentType', () => {
  test('returns the type for valid identities', () => {
    expect(getAgentType('alice-agent-claude')).toBe('claude');
    expect(getAgentType('bob-agent-codex')).toBe('codex');
    expect(getAgentType('x-agent-other')).toBe('other');
  });

  test('returns undefined for non-agents', () => {
    expect(getAgentType('alice')).toBeUndefined();
    expect(getAgentType('alice-agent-gpt')).toBeUndefined();
    expect(getAgentType('')).toBeUndefined();
  });
});

describe('constructAgentIdentity', () => {
  test('basic construction', () => {
    expect(constructAgentIdentity({ user: 'alice', type: 'claude' })).toBe('alice-agent-claude');
    expect(
      constructAgentIdentity({ user: 'swift-falcon-tater', type: 'codex' }),
    ).toBe('swift-falcon-tater-agent-codex');
  });

  test('normalizes user to lowercase + trims', () => {
    expect(constructAgentIdentity({ user: '  Alice  ', type: 'claude' })).toBe('alice-agent-claude');
    expect(constructAgentIdentity({ user: 'BOB', type: 'junie' })).toBe('bob-agent-junie');
  });

  test('rejects users with invalid characters', () => {
    expect(() => constructAgentIdentity({ user: 'alice.smith', type: 'claude' })).toThrow(InvalidAgentIdentityError);
    expect(() => constructAgentIdentity({ user: 'alice_smith', type: 'claude' })).toThrow(InvalidAgentIdentityError);
    expect(() => constructAgentIdentity({ user: 'alice smith', type: 'claude' })).toThrow(InvalidAgentIdentityError);
    expect(() => constructAgentIdentity({ user: '-alice', type: 'claude' })).toThrow(InvalidAgentIdentityError);
    expect(() => constructAgentIdentity({ user: '', type: 'claude' })).toThrow(InvalidAgentIdentityError);
  });

  test('rejects unknown types', () => {
    expect(() =>
      constructAgentIdentity({ user: 'alice', type: 'gpt' as never }),
    ).toThrow(InvalidAgentIdentityError);
  });

  test('constructed identities round-trip through isAgentIdentity', () => {
    for (const type of AGENT_TYPES) {
      const id = constructAgentIdentity({ user: 'test-user', type });
      expect(isAgentIdentity(id)).toBe(true);
      expect(getAgentType(id)).toBe(type);
    }
  });
});
