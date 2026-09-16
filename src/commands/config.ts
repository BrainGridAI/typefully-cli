import type { Command } from "commander";

import { TypefullyConfigError } from "../api/errors.js";
import { configPath, loadConfig, saveConfig, type ProfileConfig, type StoredConfig } from "../config/config.js";
import { color } from "../output/color.js";
import { printItems, printJson, writeOut, type Column } from "../output/format.js";
import { maskToken } from "./auth.js";
import { ctxOf } from "./helpers.js";

const GLOBAL_KEYS = ["social_set", "base_url", "active_profile"] as const;
type GlobalKey = (typeof GLOBAL_KEYS)[number];

function redact(config: StoredConfig): StoredConfig {
  const profiles: Record<string, ProfileConfig> = {};
  for (const [name, profile] of Object.entries(config.profiles)) {
    profiles[name] = { ...profile, ...(profile.token ? { token: maskToken(profile.token) } : {}) };
  }
  return { ...config, profiles };
}

interface ProfileRow {
  name: string;
  active: string;
  authenticated: string;
  social_set: string;
  base_url: string;
}

const profileColumns: Column<ProfileRow>[] = [
  { header: "profile", get: (r) => r.name },
  { header: "active", get: (r) => r.active },
  { header: "authenticated", get: (r) => r.authenticated },
  { header: "social_set", get: (r) => r.social_set },
  { header: "base_url", get: (r) => r.base_url },
];

function assertGlobalKey(key: string): asserts key is GlobalKey {
  if (!GLOBAL_KEYS.includes(key as GlobalKey)) {
    throw new TypefullyConfigError(`Unknown config key "${key}". Valid keys: ${GLOBAL_KEYS.join(", ")}.`);
  }
}

export function registerConfigCommands(program: Command): void {
  const config = program.command("config").description("Inspect and edit CLI configuration & profiles");

  config
    .command("path")
    .description("Print the path to the config file")
    .action(() => writeOut(configPath()));

  config
    .command("show")
    .aliases(["list", "view"])
    .description("Show the full config (secrets redacted)")
    .action(() => printJson(redact(loadConfig())));

  config
    .command("get <key>")
    .description(`Get a global config value (${GLOBAL_KEYS.join(", ")})`)
    .action((key: string) => {
      assertGlobalKey(key);
      const value = loadConfig()[key];
      writeOut(value == null ? "" : String(value));
    });

  config
    .command("set <key> <value>")
    .description(`Set a config value (${GLOBAL_KEYS.join(", ")}); --profile-scope stores social_set/base_url on the active profile`)
    .option("--profile-scope", "store on the active profile instead of globally")
    .action((key: string, value: string, opts, command: Command) => {
      assertGlobalKey(key);
      const cfg = loadConfig();
      const parsed: string | number = key === "social_set" ? Number(value) : value;
      if (key === "social_set" && (!Number.isFinite(parsed) || Number(parsed) <= 0)) {
        throw new TypefullyConfigError(`social_set must be a positive integer (got "${value}").`);
      }
      if (opts.profileScope) {
        if (key === "active_profile") throw new TypefullyConfigError("active_profile is global only.");
        const name = ctxOf(command).settings.profileName;
        const profile = { ...(cfg.profiles[name] ?? {}) } as Record<string, unknown>;
        profile[key] = parsed;
        cfg.profiles[name] = profile as ProfileConfig;
      } else {
        (cfg as unknown as Record<string, unknown>)[key] = parsed;
      }
      saveConfig(cfg);
      writeOut(color.green(`✓ set ${key} = ${value}${opts.profileScope ? " (profile)" : ""}`));
    });

  config
    .command("unset <key>")
    .description("Remove a config value")
    .option("--profile-scope", "remove from the active profile instead of globally")
    .action((key: string, opts, command: Command) => {
      assertGlobalKey(key);
      const cfg = loadConfig();
      if (opts.profileScope) {
        const name = ctxOf(command).settings.profileName;
        const profile = { ...(cfg.profiles[name] ?? {}) } as Record<string, unknown>;
        delete profile[key];
        cfg.profiles[name] = profile as ProfileConfig;
      } else {
        delete (cfg as unknown as Record<string, unknown>)[key];
      }
      saveConfig(cfg);
      writeOut(color.green(`✓ unset ${key}`));
    });

  config
    .command("profiles")
    .description("List configured profiles")
    .action((_opts, command: Command) => {
      const ctx = ctxOf(command);
      const cfg = loadConfig();
      const rows: ProfileRow[] = Object.entries(cfg.profiles).map(([name, p]) => ({
        name,
        active: cfg.active_profile === name ? "*" : "",
        authenticated: p.token ? "yes" : "no",
        social_set: p.social_set != null ? String(p.social_set) : "",
        base_url: p.base_url ?? cfg.base_url ?? "",
      }));
      printItems(rows, profileColumns, { format: ctx.format, fields: ctx.fields });
    });

  config
    .command("use <profile>")
    .description("Set the active profile")
    .action((profile: string) => {
      const cfg = loadConfig();
      if (!cfg.profiles[profile]) writeOut(color.yellow(`⚠ profile "${profile}" has no stored credentials yet.`));
      cfg.active_profile = profile;
      saveConfig(cfg);
      writeOut(color.green(`✓ active profile → ${profile}`));
    });
}
