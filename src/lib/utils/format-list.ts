// Quotes the first `max` items and counts the rest, so a long list cannot flood a message.
export function formatList(items: string[], max: number): string {
  const shown = items
    .slice(0, max)
    .map(item => `'${item}'`)
    .join(', ');
  return items.length > max ? `${shown} and ${items.length - max} more` : shown;
}

export function formatDifference(a: object, b: object): string {
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  return [...new Set([...Object.keys(left), ...Object.keys(right)])]
    .filter(key => stableStringify(left[key]) !== stableStringify(right[key]))
    .map(key => `${key}: ${stableStringify(left[key])} vs ${stableStringify(right[key])}`)
    .join(', ');
}

// Key order in a nested config object is how it was written, not what it means.
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );
}
