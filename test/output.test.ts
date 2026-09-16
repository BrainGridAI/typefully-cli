import { afterEach, describe, expect, it, vi } from "vitest";

import { draftColumns, enabledPlatforms, publishedUrls } from "../src/commands/helpers.js";
import { setColorEnabled } from "../src/output/color.js";
import { formatDateTime, parseFormat, printItems, truncate, type Column } from "../src/output/format.js";
import { renderTable } from "../src/output/table.js";

setColorEnabled(false);

function capture(fn: () => void): string {
  const spy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  try {
    fn();
    return spy.mock.calls.map((c) => String(c[0])).join("");
  } finally {
    spy.mockRestore();
  }
}

afterEach(() => vi.restoreAllMocks());

describe("format helpers", () => {
  it("parses output formats case-insensitively and rejects unknown ones", () => {
    expect(parseFormat("JSON")).toBe("json");
    expect(() => parseFormat("xml")).toThrow(/Unknown output format/);
  });
  it("formats datetimes compactly", () => {
    expect(formatDateTime("2026-09-22T17:00:00Z")).toBe("2026-09-22 17:00Z");
    expect(formatDateTime("2026-09-16T20:13:43.707Z")).toBe("2026-09-16 20:13:43Z");
    expect(formatDateTime(null)).toBe("");
  });
  it("truncates and flattens whitespace", () => {
    expect(truncate("a\n\nb   c", 10)).toBe("a b c");
    expect(truncate("x".repeat(20), 5)).toBe("xxxx…");
  });
});

describe("printItems", () => {
  interface Row {
    id: number;
    name: string;
  }
  const columns: Column<Row>[] = [
    { header: "id", get: (r) => r.id },
    { header: "name", get: (r) => r.name },
  ];
  it("renders csv with escaping", () => {
    const out = capture(() => printItems([{ id: 1, name: 'a,"b"' }], columns, { format: "csv" }));
    expect(out).toBe('id,name\n1,"a,""b"""\n');
  });
  it("renders json", () => {
    const out = capture(() => printItems([{ id: 1, name: "x" }], columns, { format: "json" }));
    expect(JSON.parse(out)).toEqual([{ id: 1, name: "x" }]);
  });
  it("selects fields in table mode", () => {
    const out = capture(() => printItems([{ id: 1, name: "x" }], columns, { format: "table", fields: ["name"] }));
    expect(out.split("\n")[0]).toBe("name");
  });
  it("renders an aligned table", () => {
    expect(renderTable(["a", "bb"], [["1", "2"]])).toBe("a  bb\n1  2 ");
  });
});

describe("draft columns", () => {
  const draft = {
    id: 7,
    social_set_id: 1,
    status: "published",
    created_at: "2026-09-16T00:00:00Z",
    tags: ["t"],
    published_at: "2026-09-16T17:00:18.532Z",
    x_post_enabled: true,
    linkedin_post_enabled: true,
    bluesky_post_enabled: false,
    x_published_url: "https://x.com/a/status/1",
    linkedin_published_url: null,
    preview: "hello",
  };
  it("derives platforms and urls from the *_enabled / *_published_url fields", () => {
    expect(enabledPlatforms(draft)).toEqual(["x", "linkedin"]);
    expect(publishedUrls(draft)).toEqual(["https://x.com/a/status/1"]);
    const row = draftColumns.map((c) => c.get(draft));
    expect(row).toEqual([7, "published", "2026-09-16 17:00:18Z", "x,linkedin", "", "hello", "t", "https://x.com/a/status/1"]);
  });
  it("falls back to platforms.*.enabled on full draft objects", () => {
    expect(enabledPlatforms({ ...draft, x_post_enabled: undefined, linkedin_post_enabled: undefined, platforms: { x: { enabled: true }, linkedin: { enabled: false } } })).toEqual(["x"]);
  });
});
