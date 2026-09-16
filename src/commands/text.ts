import type { Command } from "commander";

import { color } from "../output/color.js";
import { printItems, printJson, writeOut } from "../output/format.js";
import { X_MAX_WEIGHTED_LENGTH, xWeightedLength } from "../util/xlength.js";
import { collect, ctxOf, resolvePosts } from "./helpers.js";

export function registerTextCommands(program: Command): void {
  const text = program.command("text").description("Local text utilities (no API calls)");

  text
    .command("length [text...]")
    .alias("check")
    .description(`X weighted length per post (limit ${X_MAX_WEIGHTED_LENGTH}); exits 3 if any post is over`)
    .option("-t, --text <text>", "post text (repeatable)", collect, [])
    .option("-f, --file <path>", "read the post/thread from a file")
    .action((positional: string[], opts, command: Command) => {
      const ctx = ctxOf(command);
      const posts = resolvePosts(positional, opts);
      const rows = posts.map((p, i) => {
        const length = xWeightedLength(p);
        return { post: i + 1, length, ok: length <= X_MAX_WEIGHTED_LENGTH, text: p };
      });
      if (ctx.format === "json") printJson(rows);
      else {
        printItems(
          rows,
          [
            { header: "post", get: (r) => r.post },
            { header: "length", get: (r) => `${r.length}/${X_MAX_WEIGHTED_LENGTH}` },
            { header: "ok", get: (r) => (r.ok ? color.green("yes") : color.red("OVER")) },
            { header: "text", get: (r) => r.text },
          ],
          { format: ctx.format, fields: ctx.fields, maxColWidth: 80 },
        );
      }
      if (rows.some((r) => !r.ok)) process.exitCode = 3;
    });

  text
    .command("split [text...]")
    .description("Show how input splits into thread posts (`---` lines)")
    .option("-t, --text <text>", "post text", collect, [])
    .option("-f, --file <path>", "read from a file")
    .action((positional: string[], opts, command: Command) => {
      const ctx = ctxOf(command);
      const posts = resolvePosts(positional, opts);
      if (ctx.format === "json") printJson(posts);
      else posts.forEach((p, i) => writeOut(`${color.dim(`[${i + 1}]`)} ${p}${i < posts.length - 1 ? "\n" : ""}`));
    });
}
