import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { TypefullyConfigError } from "../api/errors.js";
import { DEFAULT_BASE_URL } from "../api/types.js";

export interface ProfileConfig {
  token?: string;
  base_url?: string;
  /** Default social set for this profile. */
  social_set?: number;
}

export interface StoredConfig {
  version: 1;
  active_profile?: string;
  base_url?: string;
  /** Global default social set (used when the profile has none). */
  social_set?: number;
  profiles: Record<string, ProfileConfig>;
}

export const DEFAULT_PROFILE = "default";

export function configDir(): string {
  const override = process.env.TYPEFULLY_CONFIG_DIR;
  if (override && override.trim()) return override;
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.trim()) return join(xdg, "typefully");
  return join(homedir(), ".config", "typefully");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function emptyConfig(): StoredConfig {
  return { version: 1, profiles: {} };
}

export function loadConfig(): StoredConfig {
  const path = configPath();
  if (!existsSync(path)) return emptyConfig();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new TypefullyConfigError(`Failed to read config at ${path}: ${(err as Error).message}`);
  }
  if (!raw.trim()) return emptyConfig();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new TypefullyConfigError(`Config at ${path} is not valid JSON: ${(err as Error).message}`);
  }
  const config = parsed as Partial<StoredConfig> & Record<string, unknown>;
  const out: StoredConfig = { version: 1, profiles: config.profiles ?? {} };
  if (config.active_profile) out.active_profile = config.active_profile;
  if (config.base_url) out.base_url = config.base_url;
  // Accept the official skill's key name too (`default_social_set_id`).
  const legacy = config.default_social_set_id;
  const social = config.social_set ?? (typeof legacy === "number" || typeof legacy === "string" ? Number(legacy) : undefined);
  if (social != null && Number.isFinite(social)) out.social_set = Number(social);
  return out;
}

export function saveConfig(config: StoredConfig): void {
  const dir = configDir();
  const path = configPath();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = join(dirname(path), `.config.${process.pid}.tmp`);
  writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // Best-effort on platforms without POSIX permissions.
  }
}

export function upsertProfile(config: StoredConfig, name: string, patch: Partial<ProfileConfig>): StoredConfig {
  const merged: Record<string, unknown> = { ...(config.profiles[name] ?? {}) };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) delete merged[key];
    else merged[key] = value;
  }
  return { ...config, profiles: { ...config.profiles, [name]: merged as ProfileConfig } };
}

export function deleteProfile(config: StoredConfig, name: string): StoredConfig {
  const profiles = { ...config.profiles };
  delete profiles[name];
  const next: StoredConfig = { ...config, profiles };
  if (config.active_profile === name) delete next.active_profile;
  return next;
}

// ---------------------------------------------------------------------------
// Effective settings resolution (flags > env > profile > global config > default)
// ---------------------------------------------------------------------------

export interface ResolveInput {
  token?: string | undefined;
  baseUrl?: string | undefined;
  profile?: string | undefined;
  socialSet?: string | number | undefined;
  config?: StoredConfig;
}

export type Source = "flag" | "env" | "profile" | "config" | "none";

export interface ResolvedSettings {
  token: string | undefined;
  tokenSource: Source;
  baseUrl: string;
  profileName: string;
  profile: ProfileConfig | undefined;
  socialSet: number | undefined;
  socialSetSource: Source;
  config: StoredConfig;
}

function envToken(): string | undefined {
  return process.env.TYPEFULLY_API_KEY?.trim() || process.env.TYPEFULLY_TOKEN?.trim() || undefined;
}

function toSocialSet(value: string | number | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    throw new TypefullyConfigError(`Invalid social set id "${value}": expected a positive integer.`);
  }
  return n;
}

export function resolveSettings(input: ResolveInput = {}): ResolvedSettings {
  const config = input.config ?? loadConfig();
  const profileName = input.profile ?? process.env.TYPEFULLY_PROFILE ?? config.active_profile ?? DEFAULT_PROFILE;
  const profile = config.profiles[profileName];

  let token: string | undefined;
  let tokenSource: Source = "none";
  const fromEnv = envToken();
  if (input.token) {
    token = input.token;
    tokenSource = "flag";
  } else if (fromEnv) {
    token = fromEnv;
    tokenSource = "env";
  } else if (profile?.token) {
    token = profile.token;
    tokenSource = "profile";
  }

  const baseUrl = input.baseUrl ?? process.env.TYPEFULLY_BASE_URL?.trim() ?? profile?.base_url ?? config.base_url ?? DEFAULT_BASE_URL;

  let socialSet: number | undefined;
  let socialSetSource: Source = "none";
  const envSet = process.env.TYPEFULLY_SOCIAL_SET?.trim();
  if (input.socialSet != null && input.socialSet !== "") {
    socialSet = toSocialSet(input.socialSet);
    socialSetSource = "flag";
  } else if (envSet) {
    socialSet = toSocialSet(envSet);
    socialSetSource = "env";
  } else if (profile?.social_set != null) {
    socialSet = toSocialSet(profile.social_set);
    socialSetSource = "profile";
  } else if (config.social_set != null) {
    socialSet = toSocialSet(config.social_set);
    socialSetSource = "config";
  }

  return { token, tokenSource, baseUrl, profileName, profile, socialSet, socialSetSource, config };
}
