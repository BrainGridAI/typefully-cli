import { describe, expect, it } from "vitest";

import { TypefullyClient, type FetchLike } from "../src/api/client.js";
import { TypefullyApiError, TypefullyNetworkError } from "../src/api/errors.js";

interface Recorded {
  url: string;
  init: RequestInit;
}

function mockFetch(responses: Array<Response | (() => Response)>): { fetch: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  let i = 0;
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return typeof next === "function" ? next() : next;
  }) as unknown as FetchLike;
  return { fetch, calls };
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });
}

function makeClient(fetch: FetchLike, overrides = {}): TypefullyClient {
  return new TypefullyClient({ token: "tf_123", fetch, sleep: async () => {}, maxRetries: 3, ...overrides });
}

describe("TypefullyClient request shaping", () => {
  it("sends the bearer header and JSON body for createDraft", async () => {
    const { fetch, calls } = mockFetch([json({ id: 1, status: "draft" })]);
    const client = makeClient(fetch);
    await client.createDraft(54758, { platforms: { x: { enabled: true, posts: [{ text: "hi" }] } } });
    expect(calls).toHaveLength(1);
    const call = calls[0]!;
    expect(call.url).toBe("https://api.typefully.com/v2/social-sets/54758/drafts");
    expect(call.init.method).toBe("POST");
    const headers = call.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer tf_123");
    expect(headers["content-type"]).toBe("application/json");
    expect(JSON.parse(String(call.init.body))).toEqual({ platforms: { x: { enabled: true, posts: [{ text: "hi" }] } } });
  });

  it("omits undefined query params", async () => {
    const { fetch, calls } = mockFetch([json({ results: [], next: null })]);
    await makeClient(fetch).listDrafts(1, { status: "scheduled", limit: 50 });
    expect(calls[0]!.url).toBe("https://api.typefully.com/v2/social-sets/1/drafts?status=scheduled&limit=50");
  });

  it("does not send an auth header for presigned uploads and no content-type", async () => {
    const { fetch, calls } = mockFetch([new Response("", { status: 200 })]);
    await makeClient(fetch).uploadToUrl("https://s3.example.com/x?sig=1", new Uint8Array([1, 2, 3]));
    const headers = (calls[0]!.init.headers ?? {}) as Record<string, string>;
    expect(headers["authorization"]).toBeUndefined();
    expect(headers["content-type"]).toBeUndefined();
    expect(calls[0]!.init.method).toBe("PUT");
  });
});

describe("TypefullyClient pagination", () => {
  it("walks drafts pages by offset until next is null", async () => {
    const { fetch, calls } = mockFetch([
      json({ results: [{ id: 1 }, { id: 2 }], next: "https://api.typefully.com/v2/x?offset=2" }),
      json({ results: [{ id: 3 }], next: null }),
    ]);
    const drafts = await makeClient(fetch).collectDrafts(9);
    expect(drafts.map((d) => d.id)).toEqual([1, 2, 3]);
    expect(calls[0]!.url).toContain("limit=50&offset=0");
    expect(calls[1]!.url).toContain("limit=50&offset=2");
  });

  it("stops collecting at max", async () => {
    const { fetch, calls } = mockFetch([json({ results: [{ id: 1 }, { id: 2 }], next: "more" })]);
    const drafts = await makeClient(fetch).collectDrafts(9, {}, 1);
    expect(drafts).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it("walks analytics pages", async () => {
    const { fetch } = mockFetch([
      json({ results: [{ post_id: "a" }], next: "n" }),
      json({ results: [{ post_id: "b" }], next: null }),
    ]);
    const rows = await makeClient(fetch).collectPostAnalytics(1, { start_date: "2026-01-01", end_date: "2026-01-02" });
    expect(rows.map((r) => r.post_id)).toEqual(["a", "b"]);
  });
});

describe("TypefullyClient errors and retries", () => {
  it("raises TypefullyApiError with the API's nested message", async () => {
    const { fetch } = mockFetch([json({ error: { code: "invalid_request", message: "publish_at is invalid" } }, { status: 422, statusText: "Unprocessable" })]);
    await expect(makeClient(fetch, { maxRetries: 0 }).me()).rejects.toMatchObject({
      name: "TypefullyApiError",
      status: 422,
      message: expect.stringContaining("publish_at is invalid"),
    });
  });

  it("retries on 429 and honours Retry-After", async () => {
    const delays: number[] = [];
    const { fetch, calls } = mockFetch([
      () => new Response("slow down", { status: 429, headers: { "retry-after": "2" } }),
      json({ id: 1, name: "n", email: "e" }),
    ]);
    const client = new TypefullyClient({
      token: "t",
      fetch,
      sleep: async (ms) => {
        delays.push(ms);
      },
    });
    const me = await client.me();
    expect(me.id).toBe(1);
    expect(calls).toHaveLength(2);
    expect(delays).toEqual([2000]);
  });

  it("gives up after maxRetries and surfaces the last status", async () => {
    const { fetch, calls } = mockFetch([() => new Response("boom", { status: 503 })]);
    await expect(makeClient(fetch, { maxRetries: 2 }).me()).rejects.toBeInstanceOf(TypefullyApiError);
    expect(calls).toHaveLength(3);
  });

  it("wraps network failures", async () => {
    const fetch = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as FetchLike;
    await expect(makeClient(fetch, { maxRetries: 0 }).me()).rejects.toBeInstanceOf(TypefullyNetworkError);
  });

  it("does not retry 4xx client errors", async () => {
    const { fetch, calls } = mockFetch([() => new Response("nope", { status: 401 })]);
    await expect(makeClient(fetch).me()).rejects.toMatchObject({ status: 401 });
    expect(calls).toHaveLength(1);
  });
});
