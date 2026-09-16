/**
 * Split a text blob into thread posts.
 *
 * Two delimiters are accepted, matching every script this CLI replaces:
 *   - a line that is exactly `---` (three or more dashes)
 *   - the literal two-character sequence `\n---\n` inside a single-line shell
 *     argument (what the Python CLI documented)
 */
export function splitThread(text: string): string[] {
  const normalized = text
    .replace(/\r\n/g, "\n")
    .replace(/\\n---\\n/g, "\n---\n")
    .replace(/\\n/g, "\n");
  return normalized
    .split(/\n[ \t]*-{3,}[ \t]*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
