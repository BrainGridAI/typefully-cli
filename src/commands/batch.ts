import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { Command } from "commander";

import { TypefullyConfigError } from "../api/errors.js";
import type { CreateDraftRequest, Draft, Platform } from "../api/types.js";
import type { CliContext } from "../context.js";
import { color } from "../output/color.js";
import { printItems, printJson, truncate, writeErr, writeOut, type Column } from "../output/format.js";
import { findOverLimit } from "../util/xlength.js";
import { buildPlatforms, ctxOf, parsePlatforms, uploadMediaFile } from "./helpers.js";

/**
 * Batch file format (a JSON content calendar):
 *
 * {
 *   "social_set": 12345,                  // optional; --social-set / env win
 *   "posts": [
 *     {
 *       "day": 3, "slot": "am",           // identity → key "3-am", title "AM D3 <campaign>"
 *       "campaign": "launch-week",
 *       "publish_at": "2026-09-20T15:57:00Z",   // or "schedule"; next-free-slot | ISO
 *       "tweets": ["main", "reply"],       // or "posts"; one string per post in the thread
 *       "platforms": ["x"],               // optional, default x
 *       "media_file": "path.mp4", "media_files": ["a.png"],  // uploaded on push
 *       "media_per_post": true,           // one media_files entry per tweet, in order
 *       "media": true,                    // legacy flag: attach by hand in Typefully
 *       "tags": ["ship"], "title": "…"    // optional overrides
 *     }
 *   ]
 * }
 */
export interface BatchPost {
  day?: number;
  slot?: string;
  campaign?: string;
  key?: string;
  title?: string;
  publish_at?: string;
  schedule?: string;
  tweets?: string[];
  posts?: string[];
  platforms?: string[] | string;
  media_file?: string;
  media_files?: string[];
  /** Attach media_files one per tweet, in order, instead of all on the first. */
  media_per_post?: boolean;
  media?: boolean;
  tags?: string[];
  draft_id?: number | string;
  [key: string]: unknown;
}

export interface BatchFile {
  social_set?: number;
  posts: BatchPost[];
}

export type RecordFile = Record<string, { id: number; campaign?: string; title?: string; publish_at?: string } | number>;

export function postKey(p: BatchPost): string {
  if (p.key) return String(p.key);
  if (p.day != null) return p.slot ? `${p.day}-${p.slot}` : String(p.day);
  throw new TypefullyConfigError(`Batch post has no "key" and no "day": ${JSON.stringify(p).slice(0, 80)}`);
}

export function postTitle(p: BatchPost): string {
  if (p.title) return p.title;
  const slot = p.slot ? `${p.slot.toUpperCase()} ` : "";
  const day = p.day != null ? `D${p.day}` : postKey(p);
  return `${slot}${day}${p.campaign ? ` ${p.campaign}` : ""}`.trim();
}

export function postTexts(p: BatchPost): string[] {
  const texts = p.tweets ?? p.posts ?? [];
  return texts.map((t) => String(t).trim()).filter(Boolean);
}

export function loadBatch(path: string): { file: BatchFile; abs: string } {
  const abs = resolve(path);
  if (!existsSync(abs)) throw new TypefullyConfigError(`Batch file not found: ${abs}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(abs, "utf8"));
  } catch (err) {
    throw new TypefullyConfigError(`Batch file is not valid JSON: ${(err as Error).message}`);
  }
  const file = parsed as BatchFile;
  if (!Array.isArray(file.posts)) throw new TypefullyConfigError(`Batch file needs a "posts" array.`);
  return { file, abs };
}

export function loadRecord(path: string | undefined): RecordFile {
  if (!path) return {};
  const abs = resolve(path);
  if (!existsSync(abs)) return {};
  try {
    return JSON.parse(readFileSync(abs, "utf8")) as RecordFile;
  } catch (err) {
    throw new TypefullyConfigError(`Record file is not valid JSON: ${(err as Error).message}`);
  }
}

export function saveRecord(path: string, record: RecordFile): void {
  const abs = resolve(path);
  const dir = dirname(abs);
  if (!existsSync(dir)) throw new TypefullyConfigError(`Record directory does not exist: ${dir}`);
  writeFileSync(abs, `${JSON.stringify(record, null, 2)}\n`);
}

export interface SelectOptions {
  day?: string | number | undefined;
  slot?: string | undefined;
  key?: string[] | undefined;
  all?: boolean | undefined;
}

export function selectPosts(posts: BatchPost[], opts: SelectOptions): BatchPost[] {
  if (!opts.all && opts.day == null && !opts.key?.length) {
    throw new TypefullyConfigError("Select posts with --day <n> [--slot <s>], --key <day-slot>, or --all.");
  }
  const keys = new Set((opts.key ?? []).map(String));
  return posts.filter((p) => {
    if (keys.size) return keys.has(postKey(p));
    if (opts.day != null && Number(p.day) !== Number(opts.day)) return false;
    if (opts.slot && p.slot !== opts.slot) return false;
    return true;
  });
}

interface PlanRow {
  key: string;
  title: string;
  publish_at: string;
  platforms: string;
  posts: number;
  media: string;
  status: string;
  draft_id: string;
  url: string;
  first: string;
}

const planColumns: Column<PlanRow>[] = [
  { header: "key", get: (r) => r.key },
  { header: "title", get: (r) => r.title },
  { header: "publish_at", get: (r) => r.publish_at },
  { header: "platforms", get: (r) => r.platforms },
  { header: "posts", get: (r) => r.posts },
  { header: "media", get: (r) => r.media },
  { header: "status", get: (r) => r.status },
  { header: "draft", get: (r) => r.draft_id },
  { header: "url", get: (r) => r.url },
  { header: "first", get: (r) => r.first },
];

function platformsOf(p: BatchPost, fallback: Platform[]): Platform[] {
  if (p.platforms == null) return fallback;
  return parsePlatforms(Array.isArray(p.platforms) ? p.platforms.join(",") : String(p.platforms));
}

function mediaFilesOf(p: BatchPost): string[] {
  if (p.media_files?.length) return p.media_files;
  if (p.media_file) return [p.media_file];
  return [];
}

async function existingTitles(ctx: CliContext, set: number): Promise<Map<string, Draft>> {
  const map = new Map<string, Draft>();
  for await (const d of ctx.client.iterateDrafts(set)) {
    if (d.draft_title) map.set(d.draft_title, d);
  }
  return map;
}

export function registerBatchCommands(program: Command): void {
  const batch = program.command("batch").description("Push a JSON content calendar of posts as scheduled drafts");

  batch
    .command("list <file>")
    .description("Show the posts in a batch file, with length checks and record status")
    .option("--day <n>", "only this day")
    .option("--slot <slot>", "only this slot (am | pm | eve | …)")
    .option("--key <key>", "only this key (repeatable)", (v: string, acc: string[]) => acc.concat(v), [])
    .option("--record <file>", "draft-ids.json to show which posts were already pushed")
    .action((file: string, opts, command: Command) => {
      const ctx = ctxOf(command);
      const { file: batchFile } = loadBatch(file);
      const record = loadRecord(opts.record);
      const posts = opts.day != null || opts.slot || opts.key.length ? selectPosts(batchFile.posts, { ...opts, all: false }) : batchFile.posts;
      const rows: PlanRow[] = posts.map((p) => {
        const key = postKey(p);
        const texts = postTexts(p);
        const over = platformsOf(p, ["x"]).includes("x") ? findOverLimit(texts) : [];
        const rec = record[key];
        const recId = rec == null ? "" : typeof rec === "number" ? String(rec) : String(rec.id);
        return {
          key,
          title: postTitle(p),
          publish_at: p.publish_at ?? p.schedule ?? "",
          platforms: platformsOf(p, ["x"]).join(","),
          posts: texts.length,
          media: mediaFilesOf(p).length ? mediaFilesOf(p).join(",") : p.media ? "(manual)" : "",
          status: over.length ? `OVER ${over.map((v) => v.length).join("/")}` : recId ? "pushed" : "",
          draft_id: recId || (p.draft_id != null ? String(p.draft_id) : ""),
          url: "",
          first: truncate(texts[0], 50),
        };
      });
      printItems(rows, planColumns, { format: ctx.format, fields: ctx.fields });
      if (rows.some((r) => r.status.startsWith("OVER"))) process.exitCode = 3;
    });

  batch
    .command("push <file>")
    .description("Create (and schedule) drafts for the selected posts; uploads media; records draft ids")
    .option("--day <n>", "push every slot for this day")
    .option("--slot <slot>", "narrow --day to one slot")
    .option("--key <key>", "push this key (repeatable)", (v: string, acc: string[]) => acc.concat(v), [])
    .option("--all", "push every post in the file")
    .option("--at <when>", "override publish_at for every selected post (next-free-slot | ISO); default: each post's own publish_at")
    .option("--unscheduled", "create plain drafts, ignoring publish_at")
    .option("--platforms <list>", "default platforms for posts that do not set their own (default x)")
    .option("--record <file>", "draft-ids.json to append {key: {id, campaign}} to after each push")
    .option("--skip-recorded", "skip posts whose key is already in --record (safe re-runs)")
    .option("--skip-existing", "skip posts whose title already exists as a draft in Typefully (walks every page)")
    .option("--no-length-check", "skip the 280 weighted-character check for X")
    .option("--dry-run", "print the request bodies instead of calling the API")
    .action(async (file: string, opts, command: Command) => {
      const ctx = ctxOf(command);
      const { file: batchFile } = loadBatch(file);
      const set = ctx.settings.socialSet ?? batchFile.social_set;
      if (set == null) throw new TypefullyConfigError("No social set: pass --social-set, set TYPEFULLY_SOCIAL_SET, or add \"social_set\" to the batch file.");
      if (!opts.dryRun) ctx.requireToken();

      const selected = selectPosts(batchFile.posts, opts);
      if (!selected.length) throw new TypefullyConfigError("No posts matched the selection.");
      if (opts.day != null && !opts.slot && selected.length > 1 && !opts.skipRecorded && !opts.skipExisting) {
        writeErr(color.yellow(`note: pushing ${selected.length} slots for day ${opts.day} (${selected.map((p) => p.slot ?? "?").join(", ")}). Add --skip-recorded or --slot to avoid duplicates on re-runs.`));
      }

      const record = loadRecord(opts.record);
      const fallbackPlatforms = parsePlatforms(opts.platforms ?? "x");
      const titles = opts.skipExisting && !opts.dryRun ? await existingTitles(ctx, set) : new Map<string, Draft>();
      const rows: PlanRow[] = [];
      const results: Array<{ key: string; draft: Draft | null; skipped?: string; body?: CreateDraftRequest }> = [];

      for (const p of selected) {
        const key = postKey(p);
        const title = postTitle(p);
        const texts = postTexts(p);
        const platforms = platformsOf(p, fallbackPlatforms);
        const media = mediaFilesOf(p);
        const when = opts.unscheduled ? undefined : (opts.at ?? p.publish_at ?? p.schedule);
        const base: PlanRow = {
          key,
          title,
          publish_at: when ?? "",
          platforms: platforms.join(","),
          posts: texts.length,
          media: media.join(","),
          status: "",
          draft_id: "",
          url: "",
          first: truncate(texts[0], 50),
        };

        if (opts.skipRecorded && record[key] != null) {
          const rec = record[key]!;
          rows.push({ ...base, status: "skipped (recorded)", draft_id: String(typeof rec === "number" ? rec : rec.id) });
          results.push({ key, draft: null, skipped: "recorded" });
          continue;
        }
        const existing = titles.get(title);
        if (existing) {
          rows.push({ ...base, status: "skipped (exists)", draft_id: String(existing.id), url: existing.private_url ?? "" });
          results.push({ key, draft: null, skipped: "exists" });
          continue;
        }

        const mediaIds: string[] = [];
        if (media.length && !opts.dryRun) {
          for (const f of media) mediaIds.push(await uploadMediaFile(ctx, set, f, { quiet: ctx.format === "json" }));
        }
        const body: CreateDraftRequest = {
          platforms: buildPlatforms({
            platforms,
            posts: texts,
            mediaIds,
            checkLength: opts.lengthCheck !== false,
            mediaPerPost: Boolean(p.media_per_post),
          }),
          draft_title: title,
        };
        if (when) body.publish_at = when;
        if (p.tags?.length) body.tags = p.tags;

        if (opts.dryRun) {
          rows.push({ ...base, status: "dry-run" });
          results.push({ key, draft: null, body });
          continue;
        }

        const draft = await ctx.client.createDraft(set, body);
        rows.push({ ...base, status: draft.status, draft_id: String(draft.id), url: draft.private_url ?? "" });
        results.push({ key, draft });
        if (opts.record) {
          record[key] = { id: draft.id, ...(p.campaign ? { campaign: p.campaign } : {}), title, ...(when ? { publish_at: when } : {}) };
          saveRecord(opts.record, record);
        }
        if (when && draft.status === "draft" && ctx.format !== "json") {
          writeErr(color.yellow(`⚠ ${key} landed as an unscheduled draft although publish_at was ${when}; check the timestamp.`));
        }
        if (p.media && !media.length && ctx.format !== "json") {
          writeErr(color.yellow(`⚠ ${key}: attach media by hand in Typefully (${draft.private_url ?? draft.id}).`));
        }
      }

      if (ctx.format === "json") {
        printJson(results);
        return;
      }
      printItems(rows, planColumns, { format: ctx.format, fields: ctx.fields });
      const created = rows.filter((r) => r.status && !r.status.startsWith("skipped") && r.status !== "dry-run").length;
      writeOut(`${created} created, ${rows.length - created} skipped/dry-run${opts.record ? ` · recorded in ${opts.record}` : ""}`);
    });
}
