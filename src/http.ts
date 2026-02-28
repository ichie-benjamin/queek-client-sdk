import type { ApiEnvelope, ApiErrorBody, QueekErrorCode, QueekHttpMethod } from './types.js';

export class QueekSdkError extends Error {
  readonly code: QueekErrorCode | string;
  readonly status: number;
  readonly details: unknown;

  constructor(message: string, code: QueekErrorCode | string, status: number, details: unknown = null) {
    super(message);
    this.name = 'QueekSdkError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface HttpClientConfig {
  baseUrl: string;
  clientKey?: string;
  vendorSlug?: string;
  fetchFn: typeof fetch;
}

export interface RequestOptions {
  path: string;
  method?: QueekHttpMethod;
  body?: unknown;
  accessToken?: string | null;
  headers?: Record<string, string>;
}

export class QueekHttpClient {
  constructor(private readonly config: HttpClientConfig) {}

  async request<T>(options: RequestOptions): Promise<ApiEnvelope<T>> {
    const url = this.buildUrl(options.path);
    const headers = new Headers(options.headers ?? {});

    headers.set('Accept', 'application/json');
    headers.set('X-Platform', 'storefront');
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

    const response = await this.config.fetchFn(url, {
      method: options.method ?? 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const payload = await this.parseJson(response);

    if (!response.ok) {
      throw this.toSdkError(response.status, payload);
    }

    return payload as ApiEnvelope<T>;
  }

  private buildUrl(path: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;

    return `${base}${normalizedPath}`;
  }

  private async parseJson(response: Response): Promise<unknown> {
    const contentType = response.headers.get('content-type') ?? '';

    if (!contentType.toLowerCase().includes('application/json')) {
      return null;
    }

    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  private toSdkError(status: number, payload: unknown): QueekSdkError {
    const body = (payload ?? {}) as ApiErrorBody;
    const code = body.error_code ?? body.error ?? 'unknown_error';
    const message = body.message ?? 'Request failed';

    return new QueekSdkError(message, code, status, body.data ?? payload);
  }
}
