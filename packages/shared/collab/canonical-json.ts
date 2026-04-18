/**
 * Deterministic JSON serialization for HMAC proof binding.
 *
 * Lexicographically sorted object keys at every nesting level,
 * no whitespace, UTF-8 bytes. Arrays preserve order.
 * undefined fields are omitted. Throws on functions, symbols, NaN, Infinity.
 *
 * This function is security-critical: its output is included in admin
 * command HMAC proofs. Any change to its output for the same input is
 * a protocol-breaking change.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'null';

  const t = typeof value;

  if (t === 'boolean') return value ? 'true' : 'false';

  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new Error(`canonicalJson: ${value} is not serializable`);
    }
    return JSON.stringify(value);
  }

  if (t === 'string') return JSON.stringify(value);

  if (t === 'function' || t === 'symbol' || t === 'bigint') {
    throw new Error(`canonicalJson: ${t} is not serializable`);
  }

  if (Array.isArray(value)) {
    const elements = value.map(v => canonicalJson(v));
    return '[' + elements.join(',') + ']';
  }

  // Plain object — sort keys lexicographically
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries: string[] = [];
  for (const key of keys) {
    const v = obj[key];
    if (v === undefined) continue; // omit undefined fields
    entries.push(JSON.stringify(key) + ':' + canonicalJson(v));
  }
  return '{' + entries.join(',') + '}';
}
