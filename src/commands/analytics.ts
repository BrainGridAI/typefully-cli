import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Command } from "commander";

import { TypefullyConfigError } from "../api/errors.js";
import type { PostAnalytics } from "../api/types.js";
import { formatDateTime, printItems, printJson, truncate, writeOut, type Column } from "../output/format.js";
import { ctxOf } from "./helpers.js";

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function num(v: number | null | undefined): number {
  return v ?? 0;
}

const postColumns: Column<PostAnalytics>[] = [
  { header: "date", get: (r) => formatDateTime(r.created_at).slice(0, 16) },
  { header: "draft", get: (r) => r.draft_id ?? "" },
  { header: "impressions", get: (r) => num(r.metrics.impressions) },
  { header: "likes", get: (r) => num(r.metrics.engagement?.likes) },
  { header: "replies", get: (r) => num(r.metrics.engagement?.comments) },
  { header: "reposts", get: (r) => num(r.metrics.engagement?.shares) },
  { header: "quotes", get: (r) => num(r.metrics.engagement?.quotes) },
  { header: "bookmarks", get: (r) => num(r.metrics.engagement?.saves) },
  { header: "profile_clicks", get: (r) => num(r.metrics.engagement?.profile_clicks) },
  { header: "link_clicks", get: (r) => num(r.metrics.engagement?.link_clicks) },
  { header: "eng_rate", get: (r) => engagementRate(r) },
  { header: "text", get: (r) => truncate(r.preview_text, 50) },
  { header: "url", get: (r) => r.url ?? "" },
];

function interactions(r: PostAnalytics): number {
  const e = r.metrics.engagement ?? {};
  return num(e.likes) + num(e.comments) + num(e.shares) + num(e.quotes) + num(e.saves);
}

function engagementRate(r: PostAnalytics): string {
  const imp = num(r.metrics.impressions);
  return imp ? `${((interactions(r) / imp) * 100).toFixed(2)}%` : "";
}

/** One row per draft: the thread's top tweet carries the metrics, link clicks are summed across the thread. */
export interface DraftGroup {
  draft_id: number | null;
  key: string;
  campaign: string;
  date: string;
  posts: number;
  impressions: number;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  bookmarks: number;
  profile_clicks: number;
  link_clicks: number;
  eng_rate: string;
  text: string;
  url: string;
}

export type DraftMap = Record<string, { id: number | string; campaign?: string }>;

export function groupByDraft(rows: PostAnalytics[], map: DraftMap = {}): DraftGroup[] {
  const byId = new Map<string, { key: string; campaign: string }>();
  for (const [key, v] of Object.entries(map)) byId.set(String(v.id), { key, campaign: v.campaign ?? "" });

  const groups = new Map<string, PostAnalytics[]>();
  for (const r of rows) {
    const k = r.draft_id != null ? String(r.draft_id) : `post:${r.post_id}`;
    const g = groups.get(k) ?? [];
    g.push(r);
    groups.set(k, g);
  }

  const out: DraftGroup[] = [];
  for (const [k, g] of groups) {
    const main = g.reduce((a, b) => (num(a.metrics.impressions) >= num(b.metrics.impressions) ? a : b));
    const e = main.metrics.engagement ?? {};
    const imp = num(main.metrics.impressions);
    const meta = main.draft_id != null ? byId.get(String(main.draft_id)) : undefined;
    out.push({
      draft_id: main.draft_id,
      key: meta?.key ?? "",
      campaign: meta?.campaign ?? "",
      date: formatDateTime(main.created_at).slice(0, 16),
      posts: g.length,
      impressions: imp,
      likes: num(e.likes),
      replies: num(e.comments),
      reposts: num(e.shares),
      quotes: num(e.quotes),
      bookmarks: num(e.saves),
      profile_clicks: num(e.profile_clicks),
      link_clicks: g.reduce((s, r) => s + num(r.metrics.engagement?.link_clicks), 0),
      eng_rate: engagementRate(main),
      text: truncate(main.preview_text, 50),
      url: main.url ?? "",
    });
    void k;
  }
  out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return out;
}

const groupColumns: Column<DraftGroup>[] = [
  { header: "date", get: (r) => r.date },
  { header: "draft", get: (r) => r.draft_id ?? "" },
  { header: "key", get: (r) => r.key },
  { header: "campaign", get: (r) => r.campaign },
  { header: "posts", get: (r) => r.posts },
  { header: "impressions", get: (r) => r.impressions },
  { header: "eng_rate", get: (r) => r.eng_rate },
  { header: "likes", get: (r) => r.likes },
  { header: "reposts", get: (r) => r.reposts },
  { header: "replies", get: (r) => r.replies },
  { header: "bookmarks", get: (r) => r.bookmarks },
  { header: "profile_clicks", get: (r) => r.profile_clicks },
  { header: "link_clicks", get: (r) => r.link_clicks },
  { header: "text", get: (r) => r.text },
  { header: "url", get: (r) => r.url },
];

export function loadDraftMap(path: string | undefined): DraftMap {
  if (!path) return {};
  const abs = resolve(path);
  if (!existsSync(abs)) throw new TypefullyConfigError(`Draft map not found: ${abs}`);
  const raw = JSON.parse(readFileSync(abs, "utf8")) as Record<string, unknown>;
  const out: DraftMap = {};
  for (const [key, v] of Object.entries(raw)) {
    if (v && typeof v === "object" && "id" in v) {
      const rec = v as { id: number | string; campaign?: string };
      out[key] = { id: rec.id, ...(rec.campaign ? { campaign: rec.campaign } : {}) };
    } else if (typeof v === "number" || typeof v === "string") {
      out[key] = { id: v };
    }
  }
  return out;
}

export function registerAnalyticsCommands(program: Command): void {
  const analytics = program.command("analytics").alias("stats").description("Post and follower analytics (X only, per the API)");

  analytics
    .command("posts")
    .description("Per-post metrics for a date range (default: last 14 days, all pages)")
    .option("--from <date>", "start date YYYY-MM-DD")
    .option("--to <date>", "end date YYYY-MM-DD (default today)")
    .option("--days <n>", "look back n days when --from is omitted", "14")
    .option("--include-replies", "include reply posts")
    .option("--group-by-draft", "one row per draft/thread (top tweet's metrics, link clicks summed)")
    .option("--map <file>", "JSON map of label → {id, campaign} to annotate --group-by-draft rows (draft-ids.json)")
    .option("--limit <n>", "stop after n posts (default all)")
    .action(async (opts, command: Command) => {
      const ctx = ctxOf(command);
      ctx.requireToken();
      const set = ctx.requireSocialSet();
      const to = opts.to ?? isoDate(new Date());
      const from = opts.from ?? isoDate(new Date(Date.parse(to) - Number(opts.days) * 86_400_000));
      const rows: PostAnalytics[] = [];
      const max = opts.limit ? Number(opts.limit) : undefined;
      for await (const row of ctx.client.iteratePostAnalytics(set, { start_date: from, end_date: to, include_replies: Boolean(opts.includeReplies) })) {
        rows.push(row);
        if (max != null && rows.length >= max) break;
      }
      if (opts.groupByDraft) {
        const groups = groupByDraft(rows, loadDraftMap(opts.map));
        printItems(groups, groupColumns, { format: ctx.format, fields: ctx.fields });
        if (ctx.format === "table") writeOut(`${groups.length} draft(s) / ${rows.length} post(s), ${from} → ${to}`);
        return;
      }
      printItems(rows, postColumns, { format: ctx.format, fields: ctx.fields });
      if (ctx.format === "table") writeOut(`${rows.length} post(s), ${from} → ${to}`);
    });

  analytics
    .command("followers")
    .description("Current follower count and the daily history")
    .option("--days <n>", "only the last n days of history")
    .action(async (opts, command: Command) => {
      const ctx = ctxOf(command);
      ctx.requireToken();
      const data = await ctx.client.getFollowers(ctx.requireSocialSet());
      let history = data.data ?? [];
      if (opts.days) history = history.slice(-Number(opts.days));
      if (ctx.format === "json") {
        printJson({ ...data, data: history });
        return;
      }
      writeOut(`current followers: ${data.current_followers_count}`);
      printItems(
        history,
        [
          { header: "date", get: (r) => r.date },
          { header: "followers", get: (r) => r.followers_count },
        ],
        { format: ctx.format, fields: ctx.fields },
      );
    });
}
