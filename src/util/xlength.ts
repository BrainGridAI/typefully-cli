/**
 * X's weighted character count: every linkifiable token counts as 23, most
 * Latin-range characters count 1, everything else (CJK, emoji, …) counts 2.
 * The hard limit for a standard post is 280.
 */
export const X_MAX_WEIGHTED_LENGTH = 280;

const LINKIFY =
  /https?:\/\/\S+|(?<![\w@.])[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.(com|build|live|app|dev|io|ai|net|org|co|me|engineering|tech|new|design|xyz|sh|gg)(\/\S*)?/gi;

function weigh(segment: string): number {
  let total = 0;
  for (const ch of segment) {
    const cp = ch.codePointAt(0) ?? 0;
    total +=
      cp <= 0x10ff ||
      (cp >= 0x2000 && cp <= 0x200d) ||
      (cp >= 0x2010 && cp <= 0x201f) ||
      (cp >= 0x2032 && cp <= 0x2037)
        ? 1
        : 2;
  }
  return total;
}

export function xWeightedLength(text: string): number {
  let total = 0;
  let last = 0;
  for (const match of text.matchAll(LINKIFY)) {
    const index = match.index ?? 0;
    total += weigh(text.slice(last, index));
    total += 23;
    last = index + match[0].length;
  }
  total += weigh(text.slice(last));
  return total;
}

export interface LengthViolation {
  index: number;
  length: number;
  text: string;
}

/** Return every post over X's limit (empty array when all fit). */
export function findOverLimit(posts: string[], max: number = X_MAX_WEIGHTED_LENGTH): LengthViolation[] {
  const out: LengthViolation[] = [];
  posts.forEach((text, index) => {
    const length = xWeightedLength(text);
    if (length > max) out.push({ index, length, text });
  });
  return out;
}
