import type { Command } from "commander";

import { printJson, writeOut } from "../output/format.js";
import { ctxOf } from "./helpers.js";

export function registerLinkedInCommands(program: Command): void {
  const linkedin = program.command("linkedin").description("LinkedIn helpers");

  linkedin
    .command("resolve-org <url>")
    .description("Resolve a LinkedIn company URL into @[Name](urn:li:organization:…) mention text")
    .action(async (url: string, _opts, command: Command) => {
      const ctx = ctxOf(command);
      ctx.requireToken();
      const result = await ctx.client.resolveLinkedInOrganization(ctx.requireSocialSet(), url);
      if (ctx.format === "json") {
        printJson(result);
        return;
      }
      writeOut(result.mention_text ?? JSON.stringify(result));
    });
}
