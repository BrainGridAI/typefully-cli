import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

import type { Command } from "commander";

import { TypefullyConfigError, TypefullyValidationError } from "../api/errors.js";
import { PLATFORMS, type Draft, type Platform, type PlatformsInput, type PostInput, type SocialSet } from "../api/types.js";
import { createContext, type CliContext, type GlobalOptions } from "../context.js";
import { color } from "../output/color.js";
import { formatDateTime, printJson, printSuccess, truncate, writeErr, type Column } from "../output/format.js";
import { splitThread } from "../util/thread.js";
import { findOverLimit, X_MAX_WEIGHTED_LENGTH } from "../util/xlength.js";

export function ctxOf(command: Command): CliContext {
  return createContext(command.optsWithGlobals() as GlobalOptions);
}

/** Emit the result of a mutating action: JSON in json mode, otherwise a success line. */
export function emitAction(ctx: CliContext, data: unknown, message: string): void {
  if (ctx.format === "json") printJson(data);
  else printSuccess(message);
}

export function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

export function parseCsv(value: string | undefined): string[] {
  if (value == null) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function parsePlatforms(value: string | undefined): Platform[] {
  const list = parseCsv(value).map((p) => p.toLowerCase());
  for (const p of list) {
    if (!PLATFORMS.includes(p as Platform)) {
      throw new TypefullyConfigError(`Unknown platform "${p}". Expected one of: ${PLATFORMS.join(", ")}.`);
    }
  }
  return list as Platform[];
}

/** Platforms with a connected account on this social set, in API order. */
export function connectedPlatforms(set: SocialSet): Platform[] {
  const out: Platform[] = [];
  for (const p of PLATFORMS) {
    if (set.platforms?.[p]) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Text input: positional, --text (repeatable = one post each), --file, stdin
// ---------------------------------------------------------------------------

export interface TextInputFlags {
  text?: string[];
  file?: string;
}

export function readStdin(): string {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * Resolve the thread's posts from the accepted inputs. Precedence: --text
 * (each occurrence is one post; a single occurrence is still split on `---`),
 * then --file, then positional words, then stdin.
 */
export function resolvePosts(positional: string[], flags: TextInputFlags, allowStdin = true): string[] {
  if (flags.text && flags.text.length > 0) {
    if (flags.text.length === 1) return splitThread(flags.text[0] ?? "");
    return flags.text.map((t) => t.trim()).filter(Boolean);
  }
  if (flags.file) {
    const path = resolve(flags.file);
    if (!existsSync(path)) throw new TypefullyConfigError(`File not found: ${path}`);
    return splitThread(readFileSync(path, "utf8"));
  }
  if (positional.length > 0) return splitThread(positional.join(" "));
  if (allowStdin && !process.stdin.isTTY) return splitThread(readStdin());
  return [];
}

// ---------------------------------------------------------------------------
// Platform payload building
// ---------------------------------------------------------------------------

export interface BuildPlatformsOptions {
  platforms: Platform[];
  posts: string[];
  mediaIds?: string[];
  replyTo?: string | undefined;
  quote?: string | undefined;
  community?: string | undefined;
  hideLinkPreview?: boolean;
  /** Throw when an X post exceeds 280 weighted chars. Default true. */
  checkLength?: boolean;
  /** Attach mediaIds one per post, in order (post 1 gets the first id, …) instead of all on the first post. */
  mediaPerPost?: boolean;
}

export function buildPlatforms(options: BuildPlatformsOptions): PlatformsInput {
  const { platforms, posts } = options;
  if (posts.length === 0) throw new TypefullyConfigError("No post text provided (use positional text, --text, --file, or stdin).");
  if (platforms.length === 0) throw new TypefullyConfigError("No platforms selected.");

  const xOnly = ["replyTo", "quote", "community"] as const;
  for (const key of xOnly) {
    if (options[key] && !platforms.includes("x")) {
      throw new TypefullyConfigError(`--${key === "replyTo" ? "reply-to" : key} only applies to X; include x in --platforms.`);
    }
  }

  if (platforms.includes("x") && options.checkLength !== false) {
    const over = findOverLimit(posts);
    if (over.length) {
      const detail = over
        .map((v) => `  post ${v.index + 1}: ${v.length}/${X_MAX_WEIGHTED_LENGTH} — "${truncate(v.text, 60)}"`)
        .join("\n");
      throw new TypefullyValidationError(
        `${over.length} post(s) exceed X's weighted ${X_MAX_WEIGHTED_LENGTH}-character limit (use --no-length-check to override):\n${detail}`,
      );
    }
  }

  if (options.mediaPerPost && (options.mediaIds?.length ?? 0) > posts.length) {
    throw new TypefullyConfigError(
      `--media-per-post: ${options.mediaIds?.length} media for ${posts.length} post(s); pass at most one per post, in post order.`,
    );
  }

  const basePosts: PostInput[] = posts.map((text, index) => {
    const post: PostInput = { text };
    if (options.mediaPerPost) {
      const id = options.mediaIds?.[index];
      if (id) post.media_ids = [id];
    } else if (index === 0 && options.mediaIds?.length) post.media_ids = options.mediaIds;
    if (options.hideLinkPreview) post.hide_link_preview = true;
    return post;
  });

  const out: PlatformsInput = {};
  for (const platform of platforms) {
    const platformPosts = basePosts.map((p) => ({ ...p }));
    if (platform === "x" && options.quote && platformPosts[0]) {
      platformPosts[0].quote_post_url = options.quote;
    }
    const entry: NonNullable<PlatformsInput[Platform]> = { enabled: true, posts: platformPosts };
    if (platform === "x" && (options.replyTo || options.community)) {
      entry.settings = {};
      if (options.replyTo) entry.settings.reply_to_url = options.replyTo;
      if (options.community) entry.settings.community_id = options.community;
    }
    out[platform] = entry;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Media upload (shared by `media upload`, `drafts create --media-file`, batch)
// ---------------------------------------------------------------------------

export interface UploadOptions {
  wait?: boolean;
  timeoutMs?: number;
  pollMs?: number;
  quiet?: boolean;
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export async function uploadMediaFile(ctx: CliContext, socialSet: number, filePath: string, options: UploadOptions = {}): Promise<string> {
  const abs = resolve(filePath);
  if (!existsSync(abs)) throw new TypefullyConfigError(`Media file not found: ${abs}`);
  const fileName = sanitizeFilename(basename(abs));
  const init = await ctx.client.initMediaUpload(socialSet, fileName);
  if (!init.upload_url || !init.media_id) throw new TypefullyConfigError("Media upload init returned no upload_url/media_id.");
  await ctx.client.uploadToUrl(init.upload_url, readFileSync(abs));
  if (options.wait === false) return init.media_id;

  const timeoutMs = options.timeoutMs ?? 90_000;
  const pollMs = options.pollMs ?? (process.env.TYPEFULLY_MEDIA_POLL_INTERVAL_MS ? Number(process.env.TYPEFULLY_MEDIA_POLL_INTERVAL_MS) : 2_000);
  const start = Date.now();
  for (;;) {
    const status = await ctx.client.getMediaStatus(socialSet, init.media_id);
    const s = (status.status ?? "").toLowerCase();
    if (!s || s === "ready" || s === "uploaded" || s === "completed") return init.media_id;
    if (s === "failed" || s === "error") throw new TypefullyConfigError(`Media processing failed for ${fileName}: ${JSON.stringify(status)}`);
    if (Date.now() - start > timeoutMs) {
      if (!options.quiet) writeErr(color.yellow(`⚠ media ${fileName} still processing after ${Math.round(timeoutMs / 1000)}s; attaching anyway`));
      return init.media_id;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

// ---------------------------------------------------------------------------
// Draft columns
// ---------------------------------------------------------------------------

export function enabledPlatforms(d: Draft): string[] {
  const out: string[] = [];
  for (const p of PLATFORMS) {
    const flag = d[`${p}_post_enabled`];
    if (flag === true) out.push(p);
    else if (flag == null && d.platforms?.[p]?.enabled) out.push(p);
  }
  return out;
}

export function publishedUrls(d: Draft): string[] {
  const out: string[] = [];
  for (const p of PLATFORMS) {
    const url = d[`${p}_published_url`];
    if (typeof url === "string" && url) out.push(url);
  }
  return out;
}

export const draftColumns: Column<Draft>[] = [
  { header: "id", get: (d) => d.id },
  { header: "status", get: (d) => d.status },
  { header: "when", get: (d) => formatDateTime(d.status === "published" ? d.published_at : d.scheduled_date) },
  { header: "platforms", get: (d) => enabledPlatforms(d).join(",") },
  { header: "title", get: (d) => d.draft_title ?? "" },
  { header: "preview", get: (d) => truncate(d.preview, 70) },
  { header: "tags", get: (d) => d.tags?.join(",") ?? "" },
  { header: "url", get: (d) => publishedUrls(d)[0] ?? d.share_url ?? d.private_url ?? "" },
];

export const draftDetailColumns: Column<Draft>[] = [
  { header: "id", get: (d) => d.id },
  { header: "social_set", get: (d) => d.social_set_id },
  { header: "status", get: (d) => d.status },
  { header: "scheduled", get: (d) => formatDateTime(d.scheduled_date) },
  { header: "published", get: (d) => formatDateTime(d.published_at) },
  { header: "platforms", get: (d) => enabledPlatforms(d).join(",") },
  { header: "title", get: (d) => d.draft_title ?? "" },
  { header: "tags", get: (d) => d.tags?.join(",") ?? "" },
  { header: "preview", get: (d) => d.preview ?? "" },
  { header: "editor", get: (d) => d.private_url ?? "" },
  { header: "share_url", get: (d) => d.share_url ?? "" },
  { header: "published_urls", get: (d) => publishedUrls(d).join(" ") },
  { header: "created", get: (d) => formatDateTime(d.created_at) },
];

export function describeDraft(d: Draft): string {
  const when = d.scheduled_date ? ` for ${formatDateTime(d.scheduled_date)}` : "";
  const link = d.private_url ? ` ${color.dim(d.private_url)}` : "";
  return `draft ${d.id} (${d.status}${when})${link}`;
}
