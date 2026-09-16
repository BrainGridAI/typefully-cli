import { describe, expect, it } from "vitest";

import { buildPlatforms, parsePlatforms, resolvePosts } from "../src/commands/helpers.js";
import { splitThread } from "../src/util/thread.js";
import { findOverLimit, xWeightedLength } from "../src/util/xlength.js";

describe("splitThread", () => {
  it("splits on --- lines and trims", () => {
    expect(splitThread("one\n---\ntwo\n\n----\n three ")).toEqual(["one", "two", "three"]);
  });
  it("accepts the literal \\n---\\n sequence from a shell argument", () => {
    expect(splitThread("first\\n---\\nsecond")).toEqual(["first", "second"]);
  });
  it("keeps a single post intact", () => {
    expect(splitThread("just one post")).toEqual(["just one post"]);
  });
});

describe("xWeightedLength", () => {
  it("counts a URL as 23", () => {
    expect(xWeightedLength("https://braingrid.ai/blog/some/very/long/path?utm=1")).toBe(23);
    expect(xWeightedLength("see braingrid.ai now")).toBe(4 + 23 + 4);
  });
  it("counts emoji and CJK as 2", () => {
    expect(xWeightedLength("a🙂")).toBe(3);
    expect(xWeightedLength("日本")).toBe(4);
  });
  it("flags posts over 280", () => {
    const over = findOverLimit(["x".repeat(281), "ok"]);
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ index: 0, length: 281 });
  });
});

describe("resolvePosts", () => {
  it("prefers --text, treating repeats as separate posts", () => {
    expect(resolvePosts(["ignored"], { text: ["a", "b"] }, false)).toEqual(["a", "b"]);
  });
  it("splits a single --text on ---", () => {
    expect(resolvePosts([], { text: ["a\n---\nb"] }, false)).toEqual(["a", "b"]);
  });
  it("uses positional words when no flags given", () => {
    expect(resolvePosts(["hello", "world"], {}, false)).toEqual(["hello world"]);
  });
});

describe("buildPlatforms", () => {
  it("builds one enabled entry per platform with media on the first post", () => {
    const body = buildPlatforms({ platforms: ["x", "linkedin"], posts: ["a", "b"], mediaIds: ["m1"] });
    expect(body.x).toEqual({ enabled: true, posts: [{ text: "a", media_ids: ["m1"] }, { text: "b" }] });
    expect(body.linkedin).toEqual({ enabled: true, posts: [{ text: "a", media_ids: ["m1"] }, { text: "b" }] });
  });
  it("puts reply/community in X settings and quote on the first X post only", () => {
    const body = buildPlatforms({ platforms: ["x", "bluesky"], posts: ["a"], replyTo: "https://x.com/u/status/1", quote: "https://x.com/u/status/2", community: "c1" });
    expect(body.x).toEqual({
      enabled: true,
      posts: [{ text: "a", quote_post_url: "https://x.com/u/status/2" }],
      settings: { reply_to_url: "https://x.com/u/status/1", community_id: "c1" },
    });
    expect(body.bluesky).toEqual({ enabled: true, posts: [{ text: "a" }] });
  });
  it("rejects X-only flags without x", () => {
    expect(() => buildPlatforms({ platforms: ["linkedin"], posts: ["a"], replyTo: "u" })).toThrow(/only applies to X/);
  });
  it("rejects over-limit X posts unless checkLength is off", () => {
    const long = "y".repeat(300);
    expect(() => buildPlatforms({ platforms: ["x"], posts: [long] })).toThrow(/exceed X's weighted/);
    expect(() => buildPlatforms({ platforms: ["linkedin"], posts: [long] })).not.toThrow();
    expect(() => buildPlatforms({ platforms: ["x"], posts: [long], checkLength: false })).not.toThrow();
  });
  it("validates platform names", () => {
    expect(() => parsePlatforms("x,facebook")).toThrow(/Unknown platform/);
    expect(parsePlatforms("X, LinkedIn")).toEqual(["x", "linkedin"]);
  });
});
