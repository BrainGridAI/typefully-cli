import type { Command } from "commander";

import { TypefullyConfigError } from "../api/errors.js";
import type { CreateDraftRequest, Draft, Platform, UpdateDraftRequest } from "../api/types.js";
import type { CliContext } from "../context.js";
import { color } from "../output/color.js";
import { printItem, printItems, printJson, writeErr, writeOut } from "../output/format.js";
import {
  buildPlatforms,
  collect,
  connectedPlatforms,
  ctxOf,
  describeDraft,
  draftColumns,
  draftDetailColumns,
  emitAction,
  parseCsv,
  parsePlatforms,
  resolvePosts,
  uploadMediaFile,
} from "./helpers.js";

interface ContentFlags {
  text?: string[];
  file?: string;
  platforms?: string;
  allPlatforms?: boolean;
  media?: string;
  mediaFile?: string[];
  mediaPerPost?: boolean;
  replyTo?: string;
  quote?: string;
  community?: string;
  hideLinkPreview?: boolean;
  lengthCheck?: boolean;
  title?: string;
  schedule?: string;
  tags?: string;
  share?: boolean;
  notes?: string;
  dryRun?: boolean;
}

/** Default platforms when none are given: X + Bluesky if connected, else the first connected one. */
export async function defaultPlatforms(ctx: CliContext, socialSet: number): Promise<Platform[]> {
  const envDefault = process.env.TYPEFULLY_DEFAULT_PLATFORMS;
  if (envDefault) return parsePlatforms(envDefault);
  const set = await ctx.client.getSocialSet(socialSet);
  const connected = connectedPlatforms(set);
  if (connected.length === 0) throw new TypefullyConfigError("This social set has no connected platforms.");
  const preferred = (["x", "bluesky"] as Platform[]).filter((p) => connected.includes(p));
  return preferred.length ? preferred : [connected[0] as Platform];
}

function normalizeSchedule(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const v = value.trim();
  if (!v) return undefined;
  if (v === "now") return "now";
  if (v === "next" || v === "next-free-slot" || v === "next_free_slot") return "next-free-slot";
  if (Number.isNaN(Date.parse(v))) {
    throw new TypefullyConfigError(`--schedule must be "now", "next-free-slot", or an ISO 8601 datetime (got "${v}").`);
  }
  return v;
}

async function contentToPlatforms(
  ctx: CliContext,
  socialSet: number,
  positional: string[],
  flags: ContentFlags,
  requireText: boolean,
): Promise<CreateDraftRequest["platforms"] | undefined> {
  const posts = resolvePosts(positional, flags, requireText);
  if (posts.length === 0) {
    if (requireText) throw new TypefullyConfigError("No post text provided (use positional text, --text, --file, or stdin).");
    return undefined;
  }

  let platforms: Platform[];
  if (flags.allPlatforms && flags.platforms) throw new TypefullyConfigError("Use either --platforms or --all-platforms, not both.");
  if (flags.allPlatforms) platforms = connectedPlatforms(await ctx.client.getSocialSet(socialSet));
  else if (flags.platforms) platforms = parsePlatforms(flags.platforms);
  else if (flags.replyTo || flags.quote || flags.community) platforms = ["x"];
  else platforms = await defaultPlatforms(ctx, socialSet);

  const mediaIds = parseCsv(flags.media);
  if (flags.mediaFile?.length && !flags.dryRun) {
    for (const file of flags.mediaFile) mediaIds.push(await uploadMediaFile(ctx, socialSet, file));
  }

  return buildPlatforms({
    platforms,
    posts,
    mediaIds,
    replyTo: flags.replyTo,
    quote: flags.quote,
    community: flags.community,
    hideLinkPreview: Boolean(flags.hideLinkPreview),
    checkLength: flags.lengthCheck !== false,
    mediaPerPost: Boolean(flags.mediaPerPost),
  });
}

function addContentOptions(cmd: Command): Command {
  return cmd
    .option("-t, --text <text>", "post text (repeat for a thread; a single value splits on `---` lines)", collect, [])
    .option("-f, --file <path>", "read the post/thread from a file (split on `---` lines)")
    .option("-p, --platforms <list>", "comma-separated platforms: x,linkedin,threads,bluesky,mastodon")
    .option("--all-platforms", "post to every connected platform")
    .option("--media <ids>", "comma-separated media ids to attach to the first post")
    .option("--media-file <path>", "upload a local image/video and attach it (repeatable)", collect, [])
    .option("--media-per-post", "attach media one per post in order (--media ids first, then --media-file in the order given) instead of all on the first post")
    .option("--reply-to <url>", "X only: reply to this post URL")
    .option("--quote <url>", "X only: quote this post URL")
    .option("--community <id>", "X only: post into this community id")
    .option("--hide-link-preview", "hide link preview cards")
    .option("--no-length-check", "skip the 280 weighted-character check for X")
    .option("--title <title>", "internal draft title (shown in Typefully, never published)")
    .option("--schedule <when>", "now | next-free-slot | ISO 8601 datetime (omit to leave as an unscheduled draft)")
    .option("--tags <list>", "comma-separated tags")
    .option("--share", "generate a public share URL")
    .option("--notes <text>", "scratchpad notes attached to the draft")
    .option("--dry-run", "print the request body instead of calling the API");
}

export function registerDraftsCommands(program: Command): void {
  const drafts = program.command("drafts").alias("draft").description("Create, list, schedule, and publish drafts");

  drafts
    .command("list")
    .alias("ls")
    .description("List drafts for the social set (walks every page unless --limit is set)")
    .option("--status <status>", "draft | scheduled | published | publishing | failed")
    .option("--scheduled", "shortcut for --status scheduled --sort scheduled_date")
    .option("--published", "shortcut for --status published")
    .option("--tag <tag>", "filter by tag")
    .option("--sort <field>", "order_by field, e.g. scheduled_date, -created_at")
    .option("--limit <n>", "stop after n drafts (default: all)")
    .option("--since <iso>", "only drafts scheduled/published after this datetime")
    .action(async (opts, command: Command) => {
      const ctx = ctxOf(command);
      ctx.requireToken();
      const set = ctx.requireSocialSet();
      const status = opts.scheduled ? "scheduled" : opts.published ? "published" : opts.status;
      const orderBy = opts.sort ?? (opts.scheduled ? "scheduled_date" : undefined);
      const max = opts.limit ? Number(opts.limit) : undefined;
      let items = await ctx.client.collectDrafts(set, { status, tag: opts.tag, order_by: orderBy }, max);
      if (opts.since) {
        const since = Date.parse(opts.since);
        if (Number.isNaN(since)) throw new TypefullyConfigError(`--since must be an ISO datetime (got "${opts.since}").`);
        items = items.filter((d) => {
          const when = d.status === "published" ? d.published_at : d.scheduled_date;
          return when ? Date.parse(when) >= since : false;
        });
      }
      printItems(items, draftColumns, { format: ctx.format, fields: ctx.fields });
    });

  drafts
    .command("get <id>")
    .alias("show")
    .description("Show one draft (full platform payload in json mode)")
    .action(async (id: string, _opts, command: Command) => {
      const ctx = ctxOf(command);
      ctx.requireToken();
      const set = ctx.requireSocialSet();
      const draft = await ctx.client.getDraft(set, id);
      if (ctx.format === "json") {
        printJson(draft);
        return;
      }
      printItem(draft as unknown as Record<string, unknown>, draftDetailColumns as never, { format: ctx.format, fields: ctx.fields });
      const x = draft.platforms?.x;
      const posts = x?.enabled && x.posts ? x.posts : firstEnabledPosts(draft);
      if (posts?.length) {
        writeOut("");
        posts.forEach((p, i) => writeOut(`${color.dim(`[${i + 1}]`)} ${p.text}`));
      }
    });

  addContentOptions(
    drafts
      .command("create [text...]")
      .alias("new")
      .description("Create a draft (unscheduled by default; add --schedule to queue or publish)"),
  ).action(async (positional: string[], opts: ContentFlags, command: Command) => {
    const ctx = ctxOf(command);
    ctx.requireToken();
    const set = ctx.requireSocialSet();
    const platforms = await contentToPlatforms(ctx, set, positional, opts, true);
    const body: CreateDraftRequest = { platforms: platforms! };
    const schedule = normalizeSchedule(opts.schedule);
    if (schedule) body.publish_at = schedule;
    if (opts.title) body.draft_title = opts.title;
    if (opts.tags != null) body.tags = parseCsv(opts.tags);
    if (opts.share) body.share = true;
    if (opts.notes) body.scratchpad_text = opts.notes;

    if (opts.dryRun) {
      printJson({ method: "POST", path: `/social-sets/${set}/drafts`, body, media_files: opts.mediaFile ?? [] });
      return;
    }
    const draft = await ctx.client.createDraft(set, body);
    emitAction(ctx, draft, `created ${describeDraft(draft)}`);
  });

  addContentOptions(
    drafts
      .command("update <id> [text...]")
      .alias("edit")
      .description("Update a draft's content, title, schedule, tags, or notes"),
  )
    .option("--append-media", "keep existing posts and only attach --media/--media-file to the first post")
    .action(async (id: string, positional: string[], opts: ContentFlags & { appendMedia?: boolean }, command: Command) => {
      const ctx = ctxOf(command);
      ctx.requireToken();
      const set = ctx.requireSocialSet();
      const body: UpdateDraftRequest = {};

      if (opts.appendMedia) {
        const current = await ctx.client.getDraft(set, id);
        const mediaIds = parseCsv(opts.media);
        for (const file of opts.mediaFile ?? []) mediaIds.push(await uploadMediaFile(ctx, set, file));
        if (!mediaIds.length) throw new TypefullyConfigError("--append-media needs --media or --media-file.");
        const platforms: UpdateDraftRequest["platforms"] = {};
        for (const [name, entry] of Object.entries(current.platforms ?? {})) {
          const e = entry as { enabled?: boolean; posts?: Array<{ text: string; media_ids?: string[] }> } | null;
          if (!e?.enabled || !e.posts?.length) continue;
          platforms[name as Platform] = {
            enabled: true,
            posts: e.posts.map((p, i) => ({
              text: p.text,
              media_ids: i === 0 ? [...(p.media_ids ?? []), ...mediaIds] : (p.media_ids ?? []),
            })),
          };
        }
        body.platforms = platforms;
      } else {
        const platforms = await contentToPlatforms(ctx, set, positional, opts, false);
        if (platforms) body.platforms = platforms;
      }

      const schedule = normalizeSchedule(opts.schedule);
      if (schedule) body.publish_at = schedule;
      if (opts.title) body.draft_title = opts.title;
      if (opts.tags != null) body.tags = parseCsv(opts.tags);
      if (opts.share) body.share = true;
      if (opts.notes) body.scratchpad_text = opts.notes;
      if (Object.keys(body).length === 0) {
        throw new TypefullyConfigError("Nothing to update: pass text, --file, --title, --schedule, --tags, --share, --notes, or --append-media.");
      }
      if (opts.dryRun) {
        printJson({ method: "PATCH", path: `/social-sets/${set}/drafts/${id}`, body });
        return;
      }
      const draft = await ctx.client.updateDraft(set, id, body);
      emitAction(ctx, draft, `updated ${describeDraft(draft)}`);
    });

  drafts
    .command("schedule <id>")
    .description("Schedule an existing draft")
    .requiredOption("--at <when>", "next-free-slot | ISO 8601 datetime")
    .action(async (id: string, opts, command: Command) => {
      const ctx = ctxOf(command);
      ctx.requireToken();
      const set = ctx.requireSocialSet();
      const when = normalizeSchedule(opts.at);
      if (!when || when === "now") throw new TypefullyConfigError("Use `drafts publish` to publish now.");
      const draft = await ctx.client.updateDraft(set, id, { publish_at: when });
      emitAction(ctx, draft, `scheduled ${describeDraft(draft)}`);
    });

  drafts
    .command("publish <id>")
    .description("Publish an existing draft immediately")
    .option("--yes", "skip the confirmation")
    .action(async (id: string, opts, command: Command) => {
      const ctx = ctxOf(command);
      ctx.requireToken();
      const set = ctx.requireSocialSet();
      if (!opts.yes && process.stdin.isTTY && ctx.format !== "json") {
        writeErr(color.yellow(`⚠ publishing draft ${id} now. Re-run with --yes to confirm.`));
        process.exitCode = 2;
        return;
      }
      const draft = await ctx.client.updateDraft(set, id, { publish_at: "now" });
      emitAction(ctx, draft, `publishing ${describeDraft(draft)}`);
    });

  drafts
    .command("delete <id...>")
    .alias("rm")
    .description("Delete one or more drafts")
    .action(async (ids: string[], _opts, command: Command) => {
      const ctx = ctxOf(command);
      ctx.requireToken();
      const set = ctx.requireSocialSet();
      const deleted: string[] = [];
      for (const id of ids) {
        await ctx.client.deleteDraft(set, id);
        deleted.push(id);
      }
      emitAction(ctx, { deleted }, `deleted ${deleted.length} draft(s): ${deleted.join(", ")}`);
    });
}

function firstEnabledPosts(draft: Draft): Array<{ text: string }> | undefined {
  for (const entry of Object.values(draft.platforms ?? {})) {
    const e = entry as { enabled?: boolean; posts?: Array<{ text: string }> } | null;
    if (e?.enabled && e.posts?.length) return e.posts;
  }
  return undefined;
}
