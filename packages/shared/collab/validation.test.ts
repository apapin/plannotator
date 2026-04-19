import { describe, expect, test } from 'bun:test';
import {
  BASE64URL_32_BYTE_RE,
  isBase64Url32ByteString,
  isValidPermissionMode,
} from './validation';

describe('isBase64Url32ByteString', () => {
  const valid43 = 'A'.repeat(43);
  test('accepts a 43-character base64url string', () => {
    expect(isBase64Url32ByteString(valid43)).toBe(true);
    expect(isBase64Url32ByteString('abcdefghij_ABCDEFGHIJ-klmnopqrst_KLMNOPQRST')).toBe(true);
  });
  test('rejects wrong-length strings', () => {
    expect(isBase64Url32ByteString('A'.repeat(42))).toBe(false);
    expect(isBase64Url32ByteString('A'.repeat(44))).toBe(false);
    expect(isBase64Url32ByteString('')).toBe(false);
  });
  test('rejects base64url-invalid characters', () => {
    expect(isBase64Url32ByteString('A'.repeat(42) + '/')).toBe(false);  // '/' not base64url
    expect(isBase64Url32ByteString('A'.repeat(42) + '+')).toBe(false);  // '+' not base64url
    expect(isBase64Url32ByteString('A'.repeat(42) + '=')).toBe(false);  // padding not expected
    expect(isBase64Url32ByteString('A'.repeat(42) + ' ')).toBe(false);
  });
  test('rejects non-string values', () => {
    expect(isBase64Url32ByteString(null)).toBe(false);
    expect(isBase64Url32ByteString(undefined)).toBe(false);
    expect(isBase64Url32ByteString(42)).toBe(false);
    expect(isBase64Url32ByteString({})).toBe(false);
  });
  test('regex constant matches helper behavior', () => {
    expect(BASE64URL_32_BYTE_RE.test(valid43)).toBe(true);
    expect(BASE64URL_32_BYTE_RE.test('A'.repeat(44))).toBe(false);
  });
});

describe('isValidPermissionMode', () => {
  test('accepts bypassPermissions', () => {
    expect(isValidPermissionMode('bypassPermissions')).toBe(true);
  });
  test('accepts acceptEdits', () => {
    expect(isValidPermissionMode('acceptEdits')).toBe(true);
  });
  test('accepts default', () => {
    expect(isValidPermissionMode('default')).toBe(true);
  });
  test('rejects unknown strings', () => {
    expect(isValidPermissionMode('admin')).toBe(false);
    expect(isValidPermissionMode('')).toBe(false);
  });
  test('rejects non-string values', () => {
    expect(isValidPermissionMode(42)).toBe(false);
    expect(isValidPermissionMode(null)).toBe(false);
    expect(isValidPermissionMode(undefined)).toBe(false);
    expect(isValidPermissionMode(true)).toBe(false);
  });
});
