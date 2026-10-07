/**
 * Stable content hash for no-op detection.
 *
 * Not cryptographic — the server only compares it to decide whether a sync op
 * actually changed anything. FNV-1a so it needs no dependency and computes
 * identically on server and client.
 *
 * Keys are sorted recursively first: `JSON.stringify` with a replacer array
 * would apply that array at every nesting level and silently drop nested
 * fields (e.g. `aktiviti[].aktiviti_guru`), producing collisions.
 */
export function hashPayload(value: unknown): string {
  return fnv1a(stableStringify(value));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(",")}}`;
}

function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
