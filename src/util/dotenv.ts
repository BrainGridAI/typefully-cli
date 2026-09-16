import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Populate `process.env` from `.env` and `.env.local` in the working directory
 * when present. Existing variables are never overwritten. Set
 * `TYPEFULLY_NO_DOTENV=1` to skip. This keeps repo-local tokens working the
 * way the scripts this CLI replaces did.
 */
export function loadDotEnv(cwd: string = process.cwd(), files: string[] = [".env", ".env.local"]): string[] {
  if (process.env.TYPEFULLY_NO_DOTENV) return [];
  const loaded: string[] = [];
  for (const name of files) {
    const path = resolve(cwd, name);
    if (!existsSync(path)) continue;
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    for (const line of raw.split("\n")) {
      const parsed = parseLine(line);
      if (!parsed) continue;
      const [key, value] = parsed;
      if (process.env[key] !== undefined) continue;
      process.env[key] = value;
    }
    loaded.push(path);
  }
  return loaded;
}

export function parseLine(rawLine: string): [string, string] | undefined {
  let line = rawLine.trim();
  if (!line || line.startsWith("#")) return undefined;
  if (line.startsWith("export ")) line = line.slice(7).trim();
  const eq = line.indexOf("=");
  if (eq === -1) return undefined;
  const key = line.slice(0, eq).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return undefined;
  let value = line.slice(eq + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  } else {
    const hash = value.indexOf(" #");
    if (hash !== -1) value = value.slice(0, hash).trim();
  }
  return [key, value];
}
