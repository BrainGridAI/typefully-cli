import { TypefullyApiError, TypefullyNetworkError } from "./errors.js";
import {
  DEFAULT_BASE_URL,
  type CreateDraftRequest,
  type Draft,
  type FollowersAnalytics,
  type LinkedInOrgResolve,
  type ListDraftsRequest,
  type ListPostAnalyticsRequest,
  type Me,
  type MediaStatus,
  type MediaUploadInit,
  type Paginated,
  type PostAnalytics,
  type QueueRule,
  type QueueSchedule,
  type QueueView,
  type SocialSet,
  type Tag,
  type UpdateDraftRequest,
} from "./types.js";

export type FetchLike = typeof globalThis.fetch;

export interface DebugEvent {
  phase: "request" | "response" | "retry" | "error";
  method: string;
  url: string;
  attempt: number;
  status?: number;
  durationMs?: number;
  message?: string;
}

export interface TypefullyClientOptions {
  /** API key from https://typefully.com/?settings=api */
  token?: string | undefined;
  /** API base. Defaults to https://api.typefully.com/v2. */
  baseUrl?: string | undefined;
  /** Max automatic retries on 429 / 5xx / network errors. Default 3. Set 0 to disable. */
  maxRetries?: number | undefined;
  /** Per-request timeout in ms. Default 60000. */
  timeoutMs?: number | undefined;
  /** Injectable fetch (for testing). Defaults to global fetch. */
  fetch?: FetchLike | undefined;
  userAgent?: string | undefined;
  onDebug?: ((event: DebugEvent) => void) | undefined;
  onRetry?: ((info: { attempt: number; delayMs: number; status?: number; reason: string }) => void) | undefined;
  sleep?: ((ms: number) => Promise<void>) | undefined;
}

interface RequestOptions {
  method: string;
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  auth?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal | undefined;
}

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Typed HTTP client for the Typefully API v2.
 *
 * Handles the bearer header, JSON encoding, retry/backoff on rate limits and
 * transient failures, request timeouts, and offset pagination.
 */
export class TypefullyClient {
  readonly baseUrl: string;
  readonly maxRetries: number;
  readonly timeoutMs: number;

  private readonly token: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly userAgent: string;
  private readonly onDebug: TypefullyClientOptions["onDebug"];
  private readonly onRetry: TypefullyClientOptions["onRetry"];
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: TypefullyClientOptions = {}) {
    this.token = options.token;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.maxRetries = options.maxRetries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.userAgent = options.userAgent ?? "typefully-cli";
    this.onDebug = options.onDebug;
    this.onRetry = options.onRetry;
    this.sleep = options.sleep ?? defaultSleep;

    if (typeof this.fetchImpl !== "function") {
      throw new TypefullyNetworkError(
        "global fetch is not available; upgrade to Node 18+ or pass a fetch implementation",
        undefined,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Me / social sets
  // -------------------------------------------------------------------------

  me(): Promise<Me> {
    return this.requestJson<Me>({ method: "GET", path: "/me" });
  }

  listSocialSets(): Promise<Paginated<SocialSet>> {
    return this.requestJson<Paginated<SocialSet>>({ method: "GET", path: "/social-sets", query: { limit: 50 } });
  }

  getSocialSet(socialSetId: number): Promise<SocialSet> {
    return this.requestJson<SocialSet>({ method: "GET", path: `/social-sets/${socialSetId}` });
  }

  // -------------------------------------------------------------------------
  // Drafts
  // -------------------------------------------------------------------------

  listDrafts(socialSetId: number, request: ListDraftsRequest = {}): Promise<Paginated<Draft>> {
    return this.requestJson<Paginated<Draft>>({
      method: "GET",
      path: `/social-sets/${socialSetId}/drafts`,
      query: {
        status: request.status,
        tag: request.tag,
        order_by: request.order_by,
        limit: request.limit,
        offset: request.offset,
      },
    });
  }

  /** Walk every page of drafts (the API pages at 10 by default, 50 max). */
  async *iterateDrafts(
    socialSetId: number,
    request: ListDraftsRequest = {},
  ): AsyncGenerator<Draft, void, undefined> {
    const pageSize = Math.min(request.limit ?? 50, 50);
    let offset = request.offset ?? 0;
    for (;;) {
      const page = await this.listDrafts(socialSetId, { ...request, limit: pageSize, offset });
      for (const draft of page.results) yield draft;
      if (!page.next || page.results.length === 0) return;
      offset += page.results.length;
    }
  }

  async collectDrafts(socialSetId: number, request: ListDraftsRequest = {}, max?: number): Promise<Draft[]> {
    const out: Draft[] = [];
    for await (const draft of this.iterateDrafts(socialSetId, request)) {
      out.push(draft);
      if (max != null && out.length >= max) break;
    }
    return out;
  }

  getDraft(socialSetId: number, draftId: number | string): Promise<Draft> {
    return this.requestJson<Draft>({
      method: "GET",
      path: `/social-sets/${socialSetId}/drafts/${encodeURIComponent(String(draftId))}`,
    });
  }

  createDraft(socialSetId: number, request: CreateDraftRequest): Promise<Draft> {
    return this.requestJson<Draft>({
      method: "POST",
      path: `/social-sets/${socialSetId}/drafts`,
      body: request,
    });
  }

  updateDraft(socialSetId: number, draftId: number | string, request: UpdateDraftRequest): Promise<Draft> {
    return this.requestJson<Draft>({
      method: "PATCH",
      path: `/social-sets/${socialSetId}/drafts/${encodeURIComponent(String(draftId))}`,
      body: request,
    });
  }

  deleteDraft(socialSetId: number, draftId: number | string): Promise<void> {
    return this.requestJson<void>({
      method: "DELETE",
      path: `/social-sets/${socialSetId}/drafts/${encodeURIComponent(String(draftId))}`,
    });
  }

  // -------------------------------------------------------------------------
  // Media
  // -------------------------------------------------------------------------

  initMediaUpload(socialSetId: number, fileName: string): Promise<MediaUploadInit> {
    return this.requestJson<MediaUploadInit>({
      method: "POST",
      path: `/social-sets/${socialSetId}/media/upload`,
      body: { file_name: fileName },
    });
  }

  getMediaStatus(socialSetId: number, mediaId: string): Promise<MediaStatus> {
    return this.requestJson<MediaStatus>({
      method: "GET",
      path: `/social-sets/${socialSetId}/media/${encodeURIComponent(mediaId)}`,
    });
  }

  /**
   * PUT bytes to the presigned S3 URL from `initMediaUpload`. No auth header and
   * no content-type: the presigned URL already encodes both.
   */
  async uploadToUrl(url: string, body: Uint8Array, signal?: AbortSignal): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, { method: "PUT", body, signal: signal ?? null });
    } catch (err) {
      throw new TypefullyNetworkError(`Upload PUT failed: ${describeError(err)}`, err);
    }
    if (!res.ok) {
      throw new TypefullyApiError({
        status: res.status,
        statusText: res.statusText,
        method: "PUT",
        url,
        body: await readBody(res),
      });
    }
    await res.arrayBuffer().catch(() => undefined);
  }

  // -------------------------------------------------------------------------
  // Tags
  // -------------------------------------------------------------------------

  listTags(socialSetId: number): Promise<Paginated<Tag>> {
    return this.requestJson<Paginated<Tag>>({
      method: "GET",
      path: `/social-sets/${socialSetId}/tags`,
      query: { limit: 50 },
    });
  }

  createTag(socialSetId: number, name: string): Promise<Tag> {
    return this.requestJson<Tag>({
      method: "POST",
      path: `/social-sets/${socialSetId}/tags`,
      body: { name },
    });
  }

  // -------------------------------------------------------------------------
  // Queue
  // -------------------------------------------------------------------------

  getQueue(socialSetId: number, startDate: string, endDate: string): Promise<QueueView> {
    return this.requestJson<QueueView>({
      method: "GET",
      path: `/social-sets/${socialSetId}/queue`,
      query: { start_date: startDate, end_date: endDate },
    });
  }

  getQueueSchedule(socialSetId: number): Promise<QueueSchedule> {
    return this.requestJson<QueueSchedule>({
      method: "GET",
      path: `/social-sets/${socialSetId}/queue/schedule`,
    });
  }

  setQueueSchedule(socialSetId: number, rules: QueueRule[]): Promise<QueueSchedule> {
    return this.requestJson<QueueSchedule>({
      method: "PUT",
      path: `/social-sets/${socialSetId}/queue/schedule`,
      body: { rules },
    });
  }

  // -------------------------------------------------------------------------
  // Analytics (X only, per the API)
  // -------------------------------------------------------------------------

  listPostAnalytics(socialSetId: number, request: ListPostAnalyticsRequest): Promise<Paginated<PostAnalytics>> {
    return this.requestJson<Paginated<PostAnalytics>>({
      method: "GET",
      path: `/social-sets/${socialSetId}/analytics/x/posts`,
      query: {
        start_date: request.start_date,
        end_date: request.end_date,
        include_replies: request.include_replies ? "true" : undefined,
        limit: request.limit,
        offset: request.offset,
      },
    });
  }

  async *iteratePostAnalytics(
    socialSetId: number,
    request: ListPostAnalyticsRequest,
  ): AsyncGenerator<PostAnalytics, void, undefined> {
    const pageSize = Math.min(request.limit ?? 100, 100);
    let offset = request.offset ?? 0;
    for (;;) {
      const page = await this.listPostAnalytics(socialSetId, { ...request, limit: pageSize, offset });
      for (const row of page.results) yield row;
      if (!page.next || page.results.length === 0) return;
      offset += page.results.length;
    }
  }

  async collectPostAnalytics(socialSetId: number, request: ListPostAnalyticsRequest): Promise<PostAnalytics[]> {
    const out: PostAnalytics[] = [];
    for await (const row of this.iteratePostAnalytics(socialSetId, request)) out.push(row);
    return out;
  }

  getFollowers(socialSetId: number): Promise<FollowersAnalytics> {
    return this.requestJson<FollowersAnalytics>({
      method: "GET",
      path: `/social-sets/${socialSetId}/analytics/x/followers`,
    });
  }

  // -------------------------------------------------------------------------
  // LinkedIn helpers
  // -------------------------------------------------------------------------

  resolveLinkedInOrganization(socialSetId: number, organizationUrl: string): Promise<LinkedInOrgResolve> {
    return this.requestJson<LinkedInOrgResolve>({
      method: "GET",
      path: `/social-sets/${socialSetId}/linkedin/organizations/resolve`,
      query: { organization_url: organizationUrl },
    });
  }

  // -------------------------------------------------------------------------
  // Core request machinery
  // -------------------------------------------------------------------------

  private async requestJson<T>(options: RequestOptions): Promise<T> {
    const res = await this.send(options);
    if (!res.ok) throw await this.toApiError(options, res);
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (!text) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new TypefullyApiError({
        status: res.status,
        statusText: res.statusText,
        method: options.method,
        url: this.baseUrl + options.path,
        body: `Expected JSON response but got: ${text.slice(0, 200)}`,
      });
    }
  }

  private async send(options: RequestOptions): Promise<Response> {
    const url = this.buildUrl(options.path, options.query);
    const headers = this.buildHeaders(options);
    const hasBody = options.body !== undefined && options.method !== "GET" && options.method !== "HEAD";
    const bodyText = hasBody ? JSON.stringify(options.body) : undefined;

    let attempt = 0;
    for (;;) {
      const start = Date.now();
      this.debug({ phase: "request", method: options.method, url, attempt });

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error("timeout")), this.timeoutMs);
      const onExternalAbort = () => controller.abort((options.signal as AbortSignal).reason);
      if (options.signal) {
        if (options.signal.aborted) controller.abort(options.signal.reason);
        else options.signal.addEventListener("abort", onExternalAbort, { once: true });
      }

      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method: options.method,
          headers,
          body: bodyText,
          signal: controller.signal,
        });
      } catch (err) {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onExternalAbort);
        if (options.signal?.aborted) throw new TypefullyNetworkError("Request aborted", err);
        const isTimeout = controller.signal.aborted;
        this.debug({ phase: "error", method: options.method, url, attempt, message: describeError(err) });
        if (attempt < this.maxRetries) {
          const delayMs = backoffDelay(attempt);
          this.onRetry?.({ attempt: attempt + 1, delayMs, reason: isTimeout ? "timeout" : "network error" });
          await this.sleep(delayMs);
          attempt += 1;
          continue;
        }
        throw new TypefullyNetworkError(
          `${isTimeout ? "Request timed out" : "Network request failed"}: ${describeError(err)}`,
          err,
        );
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onExternalAbort);
      }

      this.debug({
        phase: "response",
        method: options.method,
        url,
        attempt,
        status: res.status,
        durationMs: Date.now() - start,
      });

      if (RETRYABLE_STATUS.has(res.status) && attempt < this.maxRetries) {
        const retryAfterMs = res.status === 429 ? retryAfterFromHeaders(res.headers) : undefined;
        const delayMs = retryAfterMs ?? backoffDelay(attempt);
        this.onRetry?.({
          attempt: attempt + 1,
          delayMs,
          status: res.status,
          reason: res.status === 429 ? "rate limited" : `server error ${res.status}`,
        });
        this.debug({ phase: "retry", method: options.method, url, attempt, status: res.status });
        await res.arrayBuffer().catch(() => undefined);
        await this.sleep(delayMs);
        attempt += 1;
        continue;
      }

      return res;
    }
  }

  private async toApiError(options: RequestOptions, res: Response): Promise<TypefullyApiError> {
    const body = await readBody(res);
    const retryAfterMs = retryAfterFromHeaders(res.headers);
    return new TypefullyApiError({
      status: res.status,
      statusText: res.statusText,
      method: options.method,
      url: this.buildUrl(options.path, options.query),
      body,
      requestId: res.headers.get("x-request-id") ?? undefined,
      retryAfter: retryAfterMs != null ? retryAfterMs / 1000 : undefined,
    });
  }

  private buildUrl(path: string, query?: RequestOptions["query"]): string {
    const base = path.startsWith("http") ? path : this.baseUrl + path;
    if (!query) return base;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) params.set(key, String(value));
    }
    const qs = params.toString();
    return qs ? `${base}?${qs}` : base;
  }

  private buildHeaders(options: RequestOptions): Record<string, string> {
    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": this.userAgent,
      ...options.headers,
    };
    if (options.body !== undefined && options.method !== "GET" && options.method !== "HEAD") {
      headers["content-type"] = "application/json";
    }
    if (options.auth !== false && this.token) {
      headers["authorization"] = `Bearer ${this.token}`;
    }
    return headers;
  }

  private debug(event: DebugEvent): void {
    this.onDebug?.(event);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function retryAfterFromHeaders(headers: Headers): number | undefined {
  const raw = headers.get("retry-after");
  if (raw == null) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

function backoffDelay(attempt: number): number {
  const base = 500 * 2 ** attempt;
  const jitter = Math.floor(Math.random() * 250);
  return Math.min(base + jitter, 8_000);
}

async function readBody(res: Response): Promise<unknown> {
  let text: string;
  try {
    text = await res.text();
  } catch {
    return undefined;
  }
  if (!text) return undefined;
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.includes("json") || /^[[{]/.test(text.trim())) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
