import type {
  ApiEnvelope,
  ApiErrorBody,
  QueekErrorCode,
  QueekHttpMethod,
  QueekQuery,
} from './types.js';

/** Extra context an error can carry. */
export interface QueekSdkErrorOptions {
  /** The underlying error: a network failure, an abort, a refresh that failed. */
  cause?: unknown;
  /** The `X-Request-Id` of the failed call. Quote it when you contact support. */
  requestId?: string;
  /** Link to this code's entry in the error reference. */
  docUrl?: string;
  /** The offending field, on validation failures. */
  field?: string;
  /** Per-field messages, on validation failures. */
  errors?: Record<string, string[]>;
  /** How long the API asked you to wait before trying again, in milliseconds. */
  retryAfterMs?: number;
}

/**
 * Thrown for every failure: an error answer from the API, a network failure, a timeout,
 * an abort, or a reply the SDK cannot read. Branch on `code`, which is stable; the
 * message is for people and may be reworded.
 *
 * @example
 * ```ts
 * try {
 *   await client.get('/store/info');
 * } catch (error) {
 *   if (error instanceof QueekSdkError && error.code === 'origin_not_allowed') {
 *     console.error(error.message, error.requestId);
 *   }
 * }
 * ```
 */
export class QueekSdkError extends Error {
  readonly code: QueekErrorCode | string;
  /** The HTTP status, or `0` when no response arrived. */
  readonly status: number;
  readonly details: unknown;
  readonly requestId?: string;
  readonly docUrl?: string;
  readonly field?: string;
  readonly errors?: Record<string, string[]>;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    code: QueekErrorCode | string,
    status: number,
    details: unknown = null,
    options: QueekSdkErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'QueekSdkError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = options.requestId;
    this.docUrl = options.docUrl;
    this.field = options.field;
    this.errors = options.errors;
    this.retryAfterMs = options.retryAfterMs;
  }

  /** `true` when trying the same request again can succeed: no response, `429`, `502`, `503`, `504`. */
  get retryable(): boolean {
    return this.status === 0 || RETRYABLE_STATUSES.has(this.status);
  }
}

export interface HttpClientConfig {
  baseUrl: string;
  clientKey?: string;
  vendorSlug?: string;
  /** Value of the `X-Platform` header. */
  platform: string;
  fetchFn: typeof fetch;
  timeoutMs: number;
  maxRetries: number;
}

export interface RequestOptions {
  path: string;
  method?: QueekHttpMethod;
  body?: unknown;
  accessToken?: string | null;
  headers?: Record<string, string>;
  query?: QueekQuery;
  signal?: AbortSignal;
  timeoutMs?: number;
  maxRetries?: number;
  idempotencyKey?: string;
  requestId?: string;
}

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);
const BACKOFF_BASE_MS = 300;
const BACKOFF_CAP_MS = 5_000;
const RETRY_AFTER_CAP_MS = 30_000;

/**
 * Low-level HTTP client. Builds the URL and headers, applies the timeout and retry
 * policy, and turns every failure into a {@link QueekSdkError}.
 */
export class QueekHttpClient {
  constructor(private readonly config: HttpClientConfig) {}

  async request<T>(options: RequestOptions): Promise<ApiEnvelope<T>> {
    const method = options.method ?? 'GET';
    const url = this.buildUrl(options.path, options.query);
    const headers = this.buildHeaders(options);
    const body = options.body !== undefined ? JSON.stringify(options.body) : undefined;
    const replaySafe = method === 'GET' || Boolean(options.idempotencyKey);
    const maxRetries = replaySafe ? (options.maxRetries ?? this.config.maxRetries) : 0;

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.send<T>(url, { method, headers, body }, options);
      } catch (error) {
        if (!(error instanceof QueekSdkError) || !error.retryable || attempt >= maxRetries) {
          throw error;
        }

        await this.wait(this.retryDelayMs(error, attempt), options.signal);
      }
    }
  }

  private buildHeaders(options: RequestOptions): Headers {
    const headers = new Headers(options.headers ?? {});

    headers.set('Accept', 'application/json');
    headers.set('X-Platform', this.config.platform);
    if (this.config.clientKey) {
      headers.set('X-Client-Key', this.config.clientKey);
    }
    if (this.config.vendorSlug) {
      headers.set('X-Vendor-Slug', this.config.vendorSlug);
    }
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
    }
    if (options.accessToken) {
      headers.set('Authorization', `Bearer ${options.accessToken}`);
    }
    if (options.idempotencyKey) {
      headers.set('Idempotency-Key', options.idempotencyKey);
    }
    if (options.requestId) {
      headers.set('X-Request-Id', options.requestId);
    }

    return headers;
  }

  private async send<T>(
    url: string,
    init: { method: QueekHttpMethod; headers: Headers; body: string | undefined },
    options: RequestOptions,
  ): Promise<ApiEnvelope<T>> {
    const timeoutMs = options.timeoutMs ?? this.config.timeoutMs;
    const controller = new AbortController();
    let timedOut = false;

    const onAbort = (): void => controller.abort(options.signal?.reason);
    if (options.signal?.aborted) {
      onAbort();
    } else {
      options.signal?.addEventListener('abort', onAbort, { once: true });
    }

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs)
      : null;

    try {
      let response: Response;

      try {
        response = await this.config.fetchFn(url, { ...init, signal: controller.signal });
      } catch (cause) {
        throw this.toTransportError(cause, timedOut, options.signal?.aborted === true, timeoutMs, init.method, options.path);
      }

      return await this.readResponse<T>(response, options.path);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      options.signal?.removeEventListener('abort', onAbort);
    }
  }

  private async readResponse<T>(response: Response, path: string): Promise<ApiEnvelope<T>> {
    const requestId = response.headers.get('x-request-id') ?? undefined;
    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    const isJson = contentType.includes('application/json');
    let payload: unknown = null;
    let unreadable = false;

    if (isJson) {
      try {
        payload = await response.json();
      } catch {
        unreadable = true;
      }
    }

    if (!response.ok) {
      throw this.toSdkError(response, payload, requestId);
    }

    if (unreadable) {
      throw new QueekSdkError(
        `The reply to ${path} claimed to be JSON but could not be parsed. Check that baseUrl points at the Queek API.`,
        'invalid_response',
        response.status,
        null,
        { requestId },
      );
    }

    if (!isJson) {
      const text = response.status === 204 ? '' : await response.text().catch(() => '');
      if (text.trim() !== '') {
        throw new QueekSdkError(
          `Expected JSON from ${path} but received ${contentType || 'an unknown content type'}. Check that baseUrl points at the Queek API.`,
          'invalid_response',
          response.status,
          null,
          { requestId },
        );
      }

      return { status: 'success', message: '', data: null as T };
    }

    return payload as ApiEnvelope<T>;
  }

  private buildUrl(path: string, query?: QueekQuery): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const search = query ? this.encodeQuery(query) : '';

    if (search === '') {
      return `${base}${normalizedPath}`;
    }

    return `${base}${normalizedPath}${normalizedPath.includes('?') ? '&' : '?'}${search}`;
  }

  private encodeQuery(query: QueekQuery): string {
    const params = new URLSearchParams();

    for (const [key, value] of Object.entries(query)) {
      const values = Array.isArray(value) ? value : [value];

      for (const item of values) {
        if (item !== undefined && item !== null) {
          params.append(key, String(item));
        }
      }
    }

    return params.toString();
  }

  private toTransportError(
    cause: unknown,
    timedOut: boolean,
    cancelled: boolean,
    timeoutMs: number,
    method: QueekHttpMethod,
    path: string,
  ): QueekSdkError {
    if (timedOut) {
      return new QueekSdkError(
        `${method} ${path} did not answer within ${timeoutMs} ms. Retry, or raise timeoutMs.`,
        'timeout',
        0,
        null,
        { cause },
      );
    }

    if (cancelled || (cause instanceof Error && cause.name === 'AbortError')) {
      return new QueekSdkError(`${method} ${path} was cancelled by its AbortSignal.`, 'aborted', 0, null, { cause });
    }

    return new QueekSdkError(
      `${method} ${path} could not reach the API. Check the network connection and that baseUrl is correct.`,
      'network_error',
      0,
      null,
      { cause },
    );
  }

  private toSdkError(response: Response, payload: unknown, requestId: string | undefined): QueekSdkError {
    const body = (payload !== null && typeof payload === 'object' ? payload : {}) as ApiErrorBody;
    const detail = typeof body.error === 'object' && body.error !== null ? body.error : null;
    const code = detail?.code ?? body.error_code ?? (typeof body.error === 'string' ? body.error : undefined) ?? 'unknown_error';
    const message = detail?.message
      ?? body.message
      ?? `The API answered ${response.status} without an error message. Quote the request id if you contact support.`;

    return new QueekSdkError(message, code, response.status, body.data ?? payload, {
      requestId: detail?.request_id ?? body.request_id ?? requestId,
      docUrl: detail?.doc_url ?? body.doc_url,
      field: detail?.field,
      errors: detail?.errors,
      retryAfterMs: this.parseRetryAfter(response.headers.get('retry-after')),
    });
  }

  private parseRetryAfter(value: string | null): number | undefined {
    if (value === null || value.trim() === '') {
      return undefined;
    }

    const seconds = Number(value);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }

    const date = Date.parse(value);

    return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
  }

  private retryDelayMs(error: QueekSdkError, attempt: number): number {
    if (error.retryAfterMs !== undefined) {
      return Math.min(error.retryAfterMs, RETRY_AFTER_CAP_MS);
    }

    // Full jitter: a random delay up to an exponentially growing ceiling.
    return Math.random() * Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
  }

  private wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
      const cancel = (): void => {
        clearTimeout(timer);
        reject(new QueekSdkError('The request was cancelled by its AbortSignal.', 'aborted', 0, null, { cause: signal?.reason }));
      };
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', cancel);
        resolve();
      }, ms);

      if (signal?.aborted) {
        cancel();
      } else {
        signal?.addEventListener('abort', cancel, { once: true });
      }
    });
  }
}
