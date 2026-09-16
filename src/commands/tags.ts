import type { Command } from "commander";

import type { Tag } from "../api/types.js";
import { formatDateTime, printItems, type Column } from "../output/format.js";
import { ctxOf, emitAction } from "./helpers.js";

const tagColumns: Column<Tag>[] = [
  { header: "slug", get: (t) => t.slug },
  { header: "name", get: (t) => t.name },
  { header: "created", get: (t) => formatDateTime(t.created_at) },
];

export function registerTagsCommands(program: Command): void {
  const tags = program.command("tags").description("List and create draft tags");

  tags
    .command("list")
    .alias("ls")
    .description("List tags for the social set")
    .action(async (_opts, command: Command) => {
      const ctx = ctxOf(command);
      ctx.requireToken();
      const page = await ctx.client.listTags(ctx.requireSocialSet());
      printItems(page.results, tagColumns, { format: ctx.format, fields: ctx.fields });
    });

  tags
    .command("create <name>")
    .description("Create a tag")
    .action(async (name: string, _opts, command: Command) => {
      const ctx = ctxOf(command);
      ctx.requireToken();
      const tag = await ctx.client.createTag(ctx.requireSocialSet(), name);
      emitAction(ctx, tag, `created tag ${tag.slug}`);
    });
}
