import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { groupByDraft, loadDraftMap } from "../src/commands/analytics.js";
import { loadBatch, loadRecord, postKey, postTitle, postTexts, saveRecord, selectPosts, type BatchPost } from "../src/commands/batch.js";
import { parseSlot } from "../src/commands/queue.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "tf-batch-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const posts: BatchPost[] = [
  { day: 61, slot: "am", campaign: "h-agent-honesty", tweets: ["main", "reply"], publish_at: "2026-08-18T15:57:00Z" },
  { day: 61, slot: "pm", campaign: "pm-jira", tweets: ["pm"], publish_at: "2026-08-18T20:00:00Z" },
  { day: 62, slot: "am", campaign: "next", tweets: ["x"] },
  { key: "custom", posts: ["from posts key"] },
];

describe("batch selection and naming", () => {
  it("derives keys and titles from day/slot/campaign", () => {
    expect(postKey(posts[0]!)).toBe("61-am");
    expect(postTitle(posts[0]!)).toBe("AM D61 h-agent-honesty");
    expect(postKey(posts[3]!)).toBe("custom");
    expect(postTitle({ day: 5 })).toBe("D5");
    expect(postTexts(posts[3]!)).toEqual(["from posts key"]);
  });
  it("selects by day, day+slot, key, or all", () => {
    expect(selectPosts(posts, { day: "61" }).map(postKey)).toEqual(["61-am", "61-pm"]);
    expect(selectPosts(posts, { day: 61, slot: "pm" }).map(postKey)).toEqual(["61-pm"]);
    expect(selectPosts(posts, { key: ["custom", "62-am"] }).map(postKey)).toEqual(["62-am", "custom"]);
    expect(selectPosts(posts, { all: true })).toHaveLength(4);
    expect(() => selectPosts(posts, {})).toThrow(/Select posts/);
  });
  it("loads a batch file and validates shape", () => {
    const file = join(dir, "schedule.json");
    writeFileSync(file, JSON.stringify({ social_set: 315492, posts }));
    expect(loadBatch(file).file.social_set).toBe(315492);
    writeFileSync(file, JSON.stringify({ nope: true }));
    expect(() => loadBatch(file)).toThrow(/"posts" array/);
  });
  it("round-trips the record file", () => {
    const file = join(dir, "draft-ids.json");
    expect(loadRecord(file)).toEqual({});
    saveRecord(file, { "61-am": { id: 1, campaign: "c" } });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ "61-am": { id: 1, campaign: "c" } });
  });
});

describe("analytics grouping", () => {
  const rows = [
    { platform: "x", post_id: "1", draft_id: 10, created_at: "2026-08-18T15:57:00Z", preview_text: "main", metrics: { impressions: 500, engagement: { likes: 5, comments: 1, shares: 2, saves: 1, link_clicks: 0 } } },
    { platform: "x", post_id: "2", draft_id: 10, created_at: "2026-08-18T15:57:05Z", preview_text: "reply", metrics: { impressions: 40, engagement: { likes: 0, link_clicks: 7 } } },
    { platform: "x", post_id: "3", draft_id: null, created_at: "2026-08-19T10:00:00Z", preview_text: "manual", metrics: { impressions: 10, engagement: {} } },
  ];
  it("takes the top tweet's metrics and sums link clicks across the thread", () => {
    const groups = groupByDraft(rows, { "61-am": { id: 10, campaign: "h-agent-honesty" } });
    expect(groups).toHaveLength(2);
    const g = groups[0]!;
    expect(g).toMatchObject({ draft_id: 10, key: "61-am", campaign: "h-agent-honesty", posts: 2, impressions: 500, likes: 5, link_clicks: 7, eng_rate: "1.80%" });
    expect(groups[1]).toMatchObject({ draft_id: null, posts: 1, impressions: 10 });
  });
  it("accepts both draft-ids.json shapes", () => {
    const file = join(dir, "draft-ids.json");
    writeFileSync(file, JSON.stringify({ "54-eve": 9930823, "38-eve": { id: 5, campaign: "film" } }));
    expect(loadDraftMap(file)).toEqual({ "54-eve": { id: 9930823 }, "38-eve": { id: 5, campaign: "film" } });
  });
});

describe("queue slot parsing", () => {
  it("parses HH:MM with optional days", () => {
    expect(parseSlot("09:30")).toEqual({ h: 9, m: 30, days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] });
    expect(parseSlot("17:00@mon,Wednesday,fri")).toEqual({ h: 17, m: 0, days: ["mon", "wed", "fri"] });
    expect(() => parseSlot("25:00")).toThrow(/out of range/);
    expect(() => parseSlot("9am")).toThrow(/expected HH:MM/);
  });
});
