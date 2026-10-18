// Quotes the first `max` items and counts the rest, so a long list cannot flood a message.
export function formatList(items: string[], max: number): string {
  const shown = items
    .slice(0, max)
    .map(item => `'${item}'`)
    .join(', ');
  return items.length > max ? `${shown} and ${items.length - max} more` : shown;
}
