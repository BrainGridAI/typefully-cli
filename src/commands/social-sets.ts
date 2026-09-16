import type { Command } from "commander";

import { PLATFORMS, type SocialSet } from "../api/types.js";
import { color } from "../output/color.js";
import { printItem, printItems, printJson, writeOut, type Column } from "../output/format.js";
import { connectedPlatforms, ctxOf } from "./helpers.js";

const socialSetColumns: Column<SocialSet>[] = [
  { header: "id", get: (s) => s.id },
  { header: "username", get: (s) => `@${s.username}` },
  { header: "name", get: (s) => s.name },
  { header: "team", get: (s) => s.team?.name ?? "" },
];

export function registerSocialSetsCommands(program: Command): void {
  const sets = program.command("social-sets").alias("accounts").description("List and inspect social sets (accounts)");

  sets
    .command("list")
    .alias("ls")
    .description("List every social set the API key can access")
    .option("--platforms", "also fetch each set's connected platforms (one extra request per set)")
    .action(async (opts, command: Command) => {
      const ctx = ctxOf(command);
      ctx.requireToken();
      const page = await ctx.client.listSocialSets();
      let items = page.results;
      if (opts.platforms) {
        items = await Promise.all(items.map((s) => ctx.client.getSocialSet(s.id)));
      }
      const columns = opts.platforms
        ? [...socialSetColumns, { header: "platforms", get: (s: SocialSet) => connectedPlatforms(s).join(",") }]
        : socialSetColumns;
      const active = ctx.settings.socialSet;
      const marked = active ? [{ header: "", get: (s: SocialSet) => (s.id === active ? "*" : "") }, ...columns] : columns;
      printItems(items, marked, { format: ctx.format, fields: ctx.fields });
    });

  sets
    .command("get [id]")
    .description("Show one social set with its connected platforms and publishing quota")
    .action(async (id: string | undefined, _opts, command: Command) => {
      const ctx = ctxOf(command);
      ctx.requireToken();
      const setId = id ? Number(id) : ctx.requireSocialSet();
      const set = await ctx.client.getSocialSet(setId);
      if (ctx.format === "json") {
        printJson(set);
        return;
      }
      const detail: Column<SocialSet>[] = [
        { header: "id", get: (s) => s.id },
        { header: "username", get: (s) => `@${s.username}` },
        { header: "name", get: (s) => s.name },
        { header: "team", get: (s) => s.team?.name ?? "" },
        { header: "platforms", get: (s) => connectedPlatforms(s).join(", ") },
        {
          header: "quota",
          get: (s) => {
            const q = s.publishing_quota;
            return q ? `${q.used} used, ${q.remaining} remaining, resets ${q.resets_at}` : "";
          },
        },
      ];
      printItem(
        set as unknown as Record<string, unknown>,
        detail as unknown as Column<Record<string, unknown>>[],
        { format: ctx.format, fields: ctx.fields },
      );
      const platforms = set.platforms ?? {};
      for (const p of PLATFORMS) {
        const acct = platforms[p];
        if (acct) writeOut(`  ${color.dim(p.padEnd(9))} @${acct.username}  ${acct.profile_url ?? ""}`);
      }
    });
}
