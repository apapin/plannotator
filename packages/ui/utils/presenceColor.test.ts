import { describe, expect, test } from 'bun:test';
import {
  PRESENCE_SWATCHES,
  hashNameToSwatch,
  isValidPresenceColor,
  normalizePresenceColor,
} from './presenceColor';

describe('presenceColor — swatches', () => {
  test('SWATCHES is non-empty and all values are #RRGGBB', () => {
    expect(PRESENCE_SWATCHES.length).toBeGreaterThan(0);
    for (const s of PRESENCE_SWATCHES) {
      expect(s).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('presenceColor — hashNameToSwatch', () => {
  test('returns a value from the palette', () => {
    const out = hashNameToSwatch('alice');
    expect(PRESENCE_SWATCHES).toContain(out);
  });

  test('is deterministic for the same input', () => {
    const a = hashNameToSwatch('swift-falcon-tater');
    const b = hashNameToSwatch('swift-falcon-tater');
    expect(a).toBe(b);
  });

  test('empty name maps to a swatch (edge case: pre-identity boot)', () => {
    // ConfigStore calls this during init when the displayName cookie
    // hasn't been written yet; the function must not throw or return
    // something outside the palette.
    const out = hashNameToSwatch('');
    expect(PRESENCE_SWATCHES).toContain(out);
  });
});

describe('presenceColor — isValidPresenceColor', () => {
  test('accepts #RRGGBB in lower, upper, mixed case', () => {
    expect(isValidPresenceColor('#2563eb')).toBe(true);
    expect(isValidPresenceColor('#2563EB')).toBe(true);
    expect(isValidPresenceColor('#Ff00Aa')).toBe(true);
  });

  test('rejects shorthand, missing hash, length drift, and non-strings', () => {
    expect(isValidPresenceColor('#abc')).toBe(false);        // 3-digit shorthand
    expect(isValidPresenceColor('2563eb')).toBe(false);      // no #
    expect(isValidPresenceColor('#2563eb0')).toBe(false);    // 7 chars after #
    expect(isValidPresenceColor('#GGGGGG')).toBe(false);     // non-hex
    expect(isValidPresenceColor('')).toBe(false);
    expect(isValidPresenceColor(null)).toBe(false);
    expect(isValidPresenceColor(undefined)).toBe(false);
    expect(isValidPresenceColor(0xff0000)).toBe(false);
  });
});

describe('presenceColor — normalizePresenceColor', () => {
  test('lowercases', () => {
    expect(normalizePresenceColor('#FF00AA')).toBe('#ff00aa');
  });

  test('lowercase input is unchanged', () => {
    expect(normalizePresenceColor('#ff00aa')).toBe('#ff00aa');
  });
});
