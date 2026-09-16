import { createInterface } from "node:readline";

import type { Command } from "commander";

import { TypefullyAuthError, TypefullyConfigError } from "../api/errors.js";
import { TypefullyClient } from "../api/client.js";
import { DEFAULT_PROFILE, deleteProfile, loadConfig, saveConfig, upsertProfile } from "../config/config.js";
import type { GlobalOptions } from "../context.js";
import { color } from "../output/color.js";
import { printJson, writeOut } from "../output/format.js";
import { ctxOf, readStdin } from "./helpers.js";

function globalsOf(command: Command): GlobalOptions {
  return command.optsWithGlobals() as GlobalOptions;
}

function activeProfileName(globals: GlobalOptions): string {
  return globals.profile ?? process.env.TYPEFULLY_PROFILE ?? loadConfig().active_profile ?? DEFAULT_PROFILE;
}

export function maskToken(token: string): string {
  if (token.length <= 8) return "•".repeat(token.length);
  return `${token.slice(0, 4)}…${token.slice(-4)}`;
}

async function readTokenFromStdinOrPrompt(): Promise<string> {
  if (!process.stdin.isTTY) return readStdin().trim();
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: true });
  const question = "Typefully API key (https://typefully.com/?settings=api): ";
  return new Promise((resolvePrompt) => {
    // Hide the typed characters.
    const mutable = rl as unknown as { output: NodeJS.WritableStream; _writeToOutput: (s: string) => void };
    const original = mutable._writeToOutput;
    mutable._writeToOutput = (s: string) => {
      if (s.includes(question)) original.call(rl, question);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stderr.write("\n");
      resolvePrompt(answer.trim());
    });
  });
}

export function registerAuthCommands(program: Command): void {
  const auth = program.command("auth").description("Manage API keys and profiles");

  auth
    .command("login")
    .description("Store an API key in the active profile (prompts, or reads --token / stdin)")
    .option("--token <token>", "API key to store")
    .option("--no-verify", "skip the verification call to /me")
    .option("--set-default", "make this the active profile")
    .option("--social-set <id>", "also store a default social set for the profile")
    .action(async (opts, command: Command) => {
      const globals = globalsOf(command);
      const profileName = activeProfileName(globals);
      let token = (opts.token as string | undefined) ?? (await readTokenFromStdinOrPrompt());
      token = token.trim();
      if (!token) throw new TypefullyConfigError("No API key provided.");

      let config = upsertProfile(loadConfig(), profileName, {
        token,
        ...(opts.socialSet ? { social_set: Number(opts.socialSet) } : {}),
      });
      if (!config.active_profile || opts.setDefault) config.active_profile = profileName;
      saveConfig(config);

      if (opts.verify !== false) {
        const client = new TypefullyClient({ token, baseUrl: globals.baseUrl });
        const me = await client.me();
        writeOut(color.green(`✓ stored key for profile "${profileName}" (${maskToken(token)}) as ${me.name} <${me.email}>`));
      } else {
        writeOut(color.green(`✓ stored key for profile "${profileName}" (${maskToken(token)})`));
      }
      config = loadConfig();
      if (config.profiles[profileName]?.social_set == null && config.social_set == null) {
        writeOut(color.dim("  Tip: pick a default account with `typefully social-sets list` then `typefully config set social_set <id>`."));
      }
    });

  auth
    .command("status")
    .description("Show the resolved authentication and default social set")
    .action(async (_opts, command: Command) => {
      const ctx = ctxOf(command);
      const s = ctx.settings;
      if (ctx.format === "json") {
        printJson({
          profile: s.profileName,
          authenticated: Boolean(s.token),
          token_source: s.tokenSource,
          token_preview: s.token ? maskToken(s.token) : null,
          social_set: s.socialSet ?? null,
          social_set_source: s.socialSetSource,
          base_url: s.baseUrl,
        });
        return;
      }
      const lines = [
        `${color.bold("Profile")}        ${s.profileName}`,
        `${color.bold("Authenticated")}  ${s.token ? color.green("yes") : color.red("no")}`,
        `${color.bold("Token source")}   ${s.tokenSource}`,
      ];
      if (s.token) lines.push(`${color.bold("Token")}          ${maskToken(s.token)}`);
      lines.push(`${color.bold("Social set")}     ${s.socialSet ?? color.dim("(none)")}${s.socialSet ? color.dim(` via ${s.socialSetSource}`) : ""}`);
      lines.push(`${color.bold("Base URL")}       ${s.baseUrl}`);
      writeOut(lines.join("\n"));
    });

  auth
    .command("token")
    .description("Print the resolved API key (for scripts)")
    .action(async (_opts, command: Command) => {
      const ctx = ctxOf(command);
      if (!ctx.settings.token) throw new TypefullyAuthError("No API key available for this profile.");
      process.stdout.write(`${ctx.settings.token}\n`);
    });

  auth
    .command("whoami")
    .alias("me")
    .description("Show the authenticated Typefully user")
    .action(async (_opts, command: Command) => {
      const ctx = ctxOf(command);
      ctx.requireToken();
      const me = await ctx.client.me();
      if (ctx.format === "json") {
        printJson(me);
        return;
      }
      writeOut(`${color.bold(me.name)} <${me.email}>  id=${me.id}${me.api_key_label ? color.dim(`  key: ${me.api_key_label}`) : ""}`);
    });

  auth
    .command("logout")
    .description("Remove the stored API key from the active profile")
    .option("--all", "delete the entire profile")
    .action(async (opts, command: Command) => {
      const globals = globalsOf(command);
      const profileName = activeProfileName(globals);
      let config = loadConfig();
      if (!config.profiles[profileName]) {
        writeOut(color.dim(`Profile "${profileName}" has no stored credentials.`));
        return;
      }
      config = opts.all ? deleteProfile(config, profileName) : upsertProfile(config, profileName, { token: undefined });
      saveConfig(config);
      writeOut(color.green(`✓ logged out of profile "${profileName}"`));
    });
}
