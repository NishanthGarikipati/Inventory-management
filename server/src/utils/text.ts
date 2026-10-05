/**
 * Text helpers shared by product search, duplicate prevention and the AI
 * product matcher. Keeping normalisation in one place means "Surf Excel Matic
 * 2KG" and "Surf Excel Matic Front Load 2 Kg" normalise the same way
 * everywhere.
 */

const UNIT_SYNONYMS: Array<[RegExp, string]> = [
  [/\b(\d+(?:\.\d+)?)\s*(?:kgs?|kilograms?|kilo)\b/g, '$1kg'],
  [/\b(\d+(?:\.\d+)?)\s*(?:gms?|grams?|gr)\b/g, '$1g'],
  [/\b(\d+(?:\.\d+)?)\s*(?:ltrs?|litres?|liters?|lt)\b/g, '$1l'],
  [/\b(\d+(?:\.\d+)?)\s*(?:mls?|millilitres?|milliliters?)\b/g, '$1ml'],
  [/\b(\d+(?:\.\d+)?)\s*(?:pcs?|pieces?|nos?)\b/g, '$1pc'],
];

const NOISE_WORDS = new Set([
  'the', 'and', 'with', 'of', 'for', 'pack', 'packet', 'pouch', 'bottle', 'box',
  'combo', 'new', 'offer', 'fresh',
]);

export function normalizeName(input: string): string {
  let text = (input ?? '').toLowerCase().trim();
  text = text.replace(/[^a-z0-9.\s]/g, ' ');
  for (const [pattern, replacement] of UNIT_SYNONYMS) text = text.replace(pattern, replacement);
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

export function tokenize(input: string): string[] {
  return normalizeName(input)
    .split(' ')
    .filter((t) => t.length > 0 && !NOISE_WORDS.has(t));
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[b.length];
}

/** 0..1 similarity blending token overlap with edit distance. */
export function similarity(a: string, b: string): number {
  const normA = normalizeName(a);
  const normB = normalizeName(b);
  if (!normA || !normB) return 0;
  if (normA === normB) return 1;

  const tokensA = new Set(tokenize(normA));
  const tokensB = new Set(tokenize(normB));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersection = 0;
  for (const token of tokensA) if (tokensB.has(token)) intersection += 1;
  // Containment rather than plain Jaccard: an invoice line is usually a
  // shorter version of the catalogue name, not an equal-length variation.
  const containment = intersection / Math.min(tokensA.size, tokensB.size);
  const jaccard = intersection / (tokensA.size + tokensB.size - intersection);

  const distance = levenshtein(normA, normB);
  const editScore = 1 - distance / Math.max(normA.length, normB.length);

  return Math.max(0, Math.min(1, 0.45 * containment + 0.3 * jaccard + 0.25 * editScore));
}

/** Pulls "5kg" / "500ml" style size tokens out of a product name. */
export function extractSizeToken(input: string): string | null {
  const match = normalizeName(input).match(/\b(\d+(?:\.\d+)?)(kg|g|l|ml|pc)\b/);
  return match ? `${match[1]}${match[2]}` : null;
}

export function titleCase(input: string): string {
  return input
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toUpperCase()))
    .join(' ');
}
