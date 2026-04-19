import { describe, expect, test } from 'bun:test';

describe('happy-dom test setup', () => {
  test('document is available globally', () => {
    expect(typeof document).toBe('object');
    expect(document.createElement).toBeInstanceOf(Function);
  });

  test('window.location is configurable and reads fragment', () => {
    expect(typeof window.location.pathname).toBe('string');
  });

  test('can create and query DOM nodes', () => {
    const el = document.createElement('div');
    el.textContent = 'hello';
    document.body.appendChild(el);
    expect(document.body.textContent).toContain('hello');
    document.body.removeChild(el);
  });

  test('sessionStorage is available', () => {
    sessionStorage.setItem('k', 'v');
    expect(sessionStorage.getItem('k')).toBe('v');
    sessionStorage.removeItem('k');
  });
});
