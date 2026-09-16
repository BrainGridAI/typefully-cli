/** Base class for every error the CLI raises intentionally. */
export class TypefullyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Raised for local configuration / usage problems (bad flags, missing social set, etc.). */
export class TypefullyConfigError extends TypefullyError {}

/** Raised when authentication material is missing before a request. */
export class TypefullyAuthError extends TypefullyError {}

/** Raised when content fails a local validation (e.g. a post over X's weighted limit). */
export class TypefullyValidationError extends TypefullyError {}

export interface TypefullyApiErrorInit {
  status: number;
  statusText: string;
  method: string;
  url: string;
  body?: unknown;
  requestId?: string | undefined;
  retryAfter?: number | undefined;
}

/** Raised when the Typefully API returns a non-2xx response. */
export class TypefullyApiError extends TypefullyError {
  readonly status: number;
  readonly statusText: string;
  readonly method: string;
  readonly url: string;
  readonly body: unknown;
  readonly requestId: string | undefined;
  readonly retryAfter: number | undefined;

  constructor(init: TypefullyApiErrorInit) {
    super(TypefullyApiError.format(init));
    this.status = init.status;
    this.statusText = init.statusText;
    this.method = init.method;
    this.url = init.url;
    this.body = init.body;
    this.requestId = init.requestId;
    this.retryAfter = init.retryAfter;
  }

  get isRateLimit(): boolean {
    return this.status === 429;
  }

  get isAuth(): boolean {
    return this.status === 401 || this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  private static format(init: TypefullyApiErrorInit): string {
    const detail = extractMessage(init.body);
    const base = `Typefully API error ${init.status} ${init.statusText} on ${init.method} ${redactUrl(init.url)}`;
    return detail ? `${base}: ${detail}` : base;
  }
}

/** Raised when a request fails at the network layer (DNS, timeout, connection reset). */
export class TypefullyNetworkError extends TypefullyError {
  override readonly cause: unknown;
  constructor(message: string, cause: unknown) {
    super(message);
    this.cause = cause;
  }
}

/** Pull a human-readable message out of an arbitrary error body. */
export function extractMessage(body: unknown): string | undefined {
  if (body == null) return undefined;
  if (typeof body === "string") return body.trim() || undefined;
  if (typeof body === "object") {
    const record = body as Record<string, unknown>;
    // Typefully v2 errors look like { error: { code, message, details? } }.
    const nested = record.error;
    if (nested && typeof nested === "object") {
      const inner = nested as Record<string, unknown>;
      const parts: string[] = [];
      if (typeof inner.message === "string" && inner.message.trim()) parts.push(inner.message.trim());
      if (typeof inner.code === "string" && inner.code.trim()) parts.push(`[${inner.code}]`);
      if (inner.details != null) {
        try {
          parts.push(JSON.stringify(inner.details));
        } catch {
          // ignore
        }
      }
      if (parts.length) return parts.join(" ");
    }
    for (const key of ["message", "error", "detail", "reason"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.trim();
    }
    if (record.errors != null) {
      try {
        return JSON.stringify(record.errors);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/** Strip query strings from URLs so tokens embedded there never reach logs. */
export function redactUrl(url: string): string {
  const index = url.indexOf("?");
  return index === -1 ? url : `${url.slice(0, index)}?…`;
}
