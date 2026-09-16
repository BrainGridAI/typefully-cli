import type { Command } from "commander";

import { printJson, printSuccess } from "../output/format.js";
import { ctxOf, uploadMediaFile } from "./helpers.js";

export function registerMediaCommands(program: Command): void {
  const media = program.command("media").description("Upload images and videos for use in drafts");

  media
    .command("upload <file...>")
    .description("Upload one or more files; prints a media id per file")
    .option("--no-wait", "return as soon as the upload finishes, without waiting for processing")
    .option("--timeout <seconds>", "max seconds to wait for processing", "90")
    .action(async (files: string[], opts, command: Command) => {
      const ctx = ctxOf(command);
      ctx.requireToken();
      const set = ctx.requireSocialSet();
      const results: Array<{ file: string; media_id: string }> = [];
      for (const file of files) {
        const mediaId = await uploadMediaFile(ctx, set, file, {
          wait: opts.wait !== false,
          timeoutMs: Number(opts.timeout) * 1000,
        });
        results.push({ file, media_id: mediaId });
      }
      if (ctx.format === "json") {
        printJson(results.length === 1 ? results[0] : results);
        return;
      }
      for (const r of results) printSuccess(`${r.file} → ${r.media_id}`);
    });

  media
    .command("status <mediaId>")
    .description("Check processing status for an uploaded media id")
    .action(async (mediaId: string, _opts, command: Command) => {
      const ctx = ctxOf(command);
      ctx.requireToken();
      const set = ctx.requireSocialSet();
      const status = await ctx.client.getMediaStatus(set, mediaId);
      if (ctx.format === "json") printJson(status);
      else printSuccess(`${mediaId}: ${status.status}`);
    });
}
