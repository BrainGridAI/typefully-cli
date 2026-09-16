import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { configPath, emptyConfig, loadConfig, resolveSettings, saveConfig, upsertProfile } from "../src/config/config.js";
import { loadDotEnv, parseLine } from "../src/util/dotenv.js";

let dir: string;
const savedEnv = { ...process.env };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tf-cfg-"));
  process.env.TYPEFULLY_CONFIG_DIR = dir;
  for (const k of ["TYPEFULLY_API_KEY", "TYPEFULLY_TOKEN", "TYPEFULLY_PROFILE", "TYPEFULLY_BASE_URL", "TYPEFULLY_SOCIAL_SET", "TYPEFULLY_NO_DOTENV"]) {
    delete process.env[k];
  }
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...savedEnv };
});

describe("config persistence", () => {
  it("round-trips profiles through disk", () => {
    saveConfig(upsertProfile(emptyConfig(), "work", { token: "abc", social_set: 42 }));
    expect(configPath()).toBe(join(dir, "config.json"));
    expect(loadConfig().profiles.work).toEqual({ token: "abc", social_set: 42 });
  });

  it("accepts the official skill's default_social_set_id key", () => {
    writeFileSync(join(dir, "config.json"), JSON.stringify({ default_social_set_id: "313442" }));
    expect(loadConfig().social_set).toBe(313442);
  });
});

describe("resolveSettings precedence", () => {
  it("flag > env > profile for the token", () => {
    const config = upsertProfile(emptyConfig(), "default", { token: "profile-token" });
    expect(resolveSettings({ config }).token).toBe("profile-token");
    process.env.TYPEFULLY_TOKEN = "env-token";
    expect(resolveSettings({ config })).toMatchObject({ token: "env-token", tokenSource: "env" });
    process.env.TYPEFULLY_API_KEY = "key-token";
    expect(resolveSettings({ config }).token).toBe("key-token");
    expect(resolveSettings({ config, token: "flag" })).toMatchObject({ token: "flag", tokenSource: "flag" });
  });

  it("flag > env > profile > global for the social set", () => {
    let config = upsertProfile(emptyConfig(), "default", { social_set: 2 });
    config = { ...config, social_set: 1 };
    expect(resolveSettings({ config })).toMatchObject({ socialSet: 2, socialSetSource: "profile" });
    expect(resolveSettings({ config: { ...config, profiles: {} } })).toMatchObject({ socialSet: 1, socialSetSource: "config" });
    process.env.TYPEFULLY_SOCIAL_SET = "3";
    expect(resolveSettings({ config }).socialSet).toBe(3);
    expect(resolveSettings({ config, socialSet: "4" })).toMatchObject({ socialSet: 4, socialSetSource: "flag" });
  });

  it("rejects a non-numeric social set", () => {
    expect(() => resolveSettings({ config: emptyConfig(), socialSet: "abc" })).toThrow(/Invalid social set/);
  });
});

describe("dotenv loader", () => {
  it("parses quoted values, export prefix, and inline comments", () => {
    expect(parseLine('TYPEFULLY_TOKEN="abc"')).toEqual(["TYPEFULLY_TOKEN", "abc"]);
    expect(parseLine("export FOO='bar'")).toEqual(["FOO", "bar"]);
    expect(parseLine("FOO=bar # comment")).toEqual(["FOO", "bar"]);
    expect(parseLine("# comment")).toBeUndefined();
    expect(parseLine("not a pair")).toBeUndefined();
  });

  it("loads .env and .env.local without overriding existing env", () => {
    writeFileSync(join(dir, ".env"), "TYPEFULLY_TOKEN=from-env-file\nOTHER=1\n");
    writeFileSync(join(dir, ".env.local"), "TYPEFULLY_SOCIAL_SET=99\n");
    process.env.OTHER = "keep";
    const loaded = loadDotEnv(dir);
    expect(loaded).toHaveLength(2);
    expect(process.env.TYPEFULLY_TOKEN).toBe("from-env-file");
    expect(process.env.TYPEFULLY_SOCIAL_SET).toBe("99");
    expect(process.env.OTHER).toBe("keep");
  });

  it("is skipped by TYPEFULLY_NO_DOTENV", () => {
    writeFileSync(join(dir, ".env"), "TYPEFULLY_TOKEN=x\n");
    process.env.TYPEFULLY_NO_DOTENV = "1";
    expect(loadDotEnv(dir)).toEqual([]);
    expect(process.env.TYPEFULLY_TOKEN).toBeUndefined();
  });
});
