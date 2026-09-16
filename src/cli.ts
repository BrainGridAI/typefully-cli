import { createRequire } from "node:module";

import { Command, Option } from "commander";

import {
  TypefullyApiError,
  TypefullyAuthError,
  TypefullyConfigError,
  TypefullyError,
  TypefullyNetworkError,
  TypefullyValidationError,
} from "./api/errors.js";
import { registerAnalyticsCommands } from "./commands/analytics.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerBatchCommands } from "./commands/batch.js";
import { registerConfigCommands } from "./commands/config.js";
import { registerDraftsCommands } from "./commands/drafts.js";
import { registerLinkedInCommands } from "./commands/linkedin.js";
import { registerMediaCommands } from "./commands/media.js";
import { registerQueueCommands } from "./commands/queue.js";
import { registerSocialSetsCommands } from "./commands/social-sets.js";
import { registerTagsCommands } from "./commands/tags.js";
import { registerTextCommands } from "./commands/text.js";
import { color } from "./output/color.js";
import { loadDotEnv } from "./util/dotenv.js";

function readVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../package.json") as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const GLOBAL_OPTION_SPECS: Array<[string, string]> = [
  ["--token <token>", "Typefully API key"],
  ["--profile <name>", "configuration profile to use"],
  ["-s, --social-set <id>", "social set (account) id to operate on"],
  ["--base-url <url>", "override the API base URL"],
  ["-o, --output <format>", "output format: table | json | csv"],
  ["--fields <list>", "comma-separated columns to show (table/csv)"],
  ["--no-color", "disable colored output"],
  ["--debug", "log HTTP requests to stderr"],
  ["--timeout <ms>", "per-request timeout in milliseconds"],
  ["--max-retries <n>", "max retries on 429/5xx/network errors"],
  ["--no-retry", "disable automatic retries"],
];

/** Attach the shared options to a command (skipping flags it already defines). */
export function addGlobalOptions(command: Command): Command {
  const existingLongs = new Set(command.options.map((o) => o.long).filter(Boolean) as string[]);
  const existingShorts = new Set(command.options.map((o) => o.short).filter(Boolean) as string[]);
  for (const [flags, description] of GLOBAL_OPTION_SPECS) {
    const option = new Option(flags, description);
    if (option.long && existingLongs.has(option.long)) continue;
    if (option.short && existingShorts.has(option.short)) continue;
    command.addOption(option);
  }
  return command;
}

function attachGlobalOptionsToLeaves(command: Command): void {
  if (command.commands.length === 0) {
    addGlobalOptions(command);
    return;
  }
  for (const sub of command.commands) attachGlobalOptionsToLeaves(sub);
}

export function buildProgram(): Command {
  const program = new Command();

  program
    .name("typefully")
    .description("Comprehensive command-line interface for the Typefully API (v2)")
    .version(readVersion(), "-v, --version", "print the CLI version")
    .showHelpAfterError("(add --help for usage)");

  program.addHelpText(
    "after",
    `
Global options (available on every command, placed after the command):
  --token <token>          Typefully API key
  --profile <name>         configuration profile to use
  -s, --social-set <id>    social set (account) id to operate on
  --base-url <url>         override the API base URL
  -o, --output <format>    output format: table | json | csv
  --fields <list>          comma-separated columns to show (table/csv)
  --no-color               disable colored output
  --debug                  log HTTP requests to stderr
  --timeout <ms>           per-request timeout in milliseconds
  --max-retries <n>        retries on 429/5xx/network errors (--no-retry to disable)

Environment variables:
  TYPEFULLY_API_KEY      API key (TYPEFULLY_TOKEN is accepted as an alias)
  TYPEFULLY_SOCIAL_SET   default social set id
  TYPEFULLY_BASE_URL     API base URL
  TYPEFULLY_PROFILE      default profile name
  TYPEFULLY_CONFIG_DIR   directory for the config file
  TYPEFULLY_NO_DOTENV    set to skip reading ./.env and ./.env.local
  NO_COLOR               disable colored output

Examples:
  typefully auth login                                      store an API key
  typefully social-sets list                                list accounts and their ids
  typefully config set social_set 54758                     pick a default account
  typefully drafts create "Hello world"                     unscheduled draft on the default platforms
  typefully drafts create -f thread.md --schedule next-free-slot
  typefully drafts create "Take" --platforms x --reply-to https://x.com/u/status/1
  typefully drafts list --status scheduled                  upcoming posts
  typefully analytics posts --from 2026-09-01 --group-by-draft
  typefully batch push gtm/twitter/schedule-60.json --day 62 --record gtm/twitter/draft-ids.json
`,
  );

  registerAuthCommands(program);
  registerSocialSetsCommands(program);
  registerDraftsCommands(program);
  registerMediaCommands(program);
  registerTagsCommands(program);
  registerQueueCommands(program);
  registerAnalyticsCommands(program);
  registerLinkedInCommands(program);
  registerBatchCommands(program);
  registerTextCommands(program);
  registerConfigCommands(program);

  attachGlobalOptionsToLeaves(program);
  return program;
}

export async function run(argv: string[] = process.argv): Promise<void> {
  loadDotEnv();
  const program = buildProgram();
  try {
    await program.parseAsync(argv);
  } catch (err) {
    handleError(err);
    process.exitCode = exitCodeFor(err);
  }
}

function exitCodeFor(err: unknown): number {
  if (err instanceof TypefullyConfigError) return 2;
  if (err instanceof TypefullyValidationError) return 3;
  return 1;
}

function handleError(err: unknown): void {
  const write = (msg: string) => process.stderr.write(`${msg}\n`);

  if (err instanceof TypefullyApiError) {
    write(color.red(`✗ ${err.message}`));
    if (err.isAuth) write(color.dim("  Your API key may be missing or invalid. Try `typefully auth status`."));
    if (err.isRateLimit && err.retryAfter) write(color.dim(`  Rate limited. Retry after ${err.retryAfter}s.`));
    return;
  }
  if (err instanceof TypefullyNetworkError) {
    write(color.red(`✗ ${err.message}`));
    write(color.dim("  Check your connection and --base-url."));
    return;
  }
  if (err instanceof TypefullyAuthError || err instanceof TypefullyConfigError || err instanceof TypefullyValidationError) {
    write(color.red(`✗ ${err.message}`));
    return;
  }
  if (err instanceof TypefullyError) {
    write(color.red(`✗ ${err.message}`));
    return;
  }
  write(color.red(`✗ Unexpected error: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`));
}
