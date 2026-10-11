import { QueekHttpClient, QueekSdkError } from './http.js';
import { InMemoryStorageAdapter } from './storage.js';
import type {
  ApiEnvelope,
  EmailRegisterOtpPayload,
  EmailRegisterOtpResponse,
  EmailRequestOtpPayload,
  EmailRequestOtpResponse,
  EmailVerifyOtpPayload,
  EmailVerifyOtpResponse,
  MeResponse,
  QueekClientConfig,
  QueekRequestConfig,
  QueekRequestOptions,
  RegisterPayload,
  RegisterResponse,
  RefreshResponse,
  RequestOtpPayload,
  RequestOtpResponse,
  VerifyOtpPayload,
  VerifyOtpResponse,
} from './types.js';

const DEFAULT_AUTH_PREFIX = '/client/auth';
const DEFAULT_HEADER_PLATFORM = 'storefront';
const DEFAULT_TOKEN_PLATFORM = 'client_web';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_ACCESS_STORAGE_KEY = 'queek_client_access_token';
const DEFAULT_REFRESH_STORAGE_KEY = 'queek_client_refresh_token';

/** Sign-in routes that run before a session exists. A `401` from these is an answer, not an expired session. */
const SIGN_IN_ROUTES = ['/phone/', '/email/', '/register', '/token/refresh'];

/**
 * The client behind {@link createQueekClient}: customer sign-in, the session's token
 * lifecycle (persist, refresh once on `401`, clear), and the generic HTTP verbs.
 */
export class QueekClientAuth {
  private readonly http: QueekHttpClient;
  private readonly accessStorage;
  private readonly refreshStorage;
  private readonly accessStorageKey: string;
  private readonly refreshStorageKey: string;
  private readonly platform: string;
  private readonly authPrefix: string;
  private readonly onUnauthenticated: QueekClientConfig['onUnauthenticated'];

  private accessToken: string | null;
  private refreshToken: string | null;
  private refreshPromise: Promise<RefreshResponse> | null = null;

  constructor(config: QueekClientConfig) {
    const fetchFn = config.fetch ?? globalThis.fetch?.bind(globalThis);

    if (!fetchFn) {
      throw new Error('No fetch implementation available. Pass config.fetch when the runtime has no global fetch.');
    }

    if (!config.baseUrl) {
      throw new Error('baseUrl is required. Example: https://client.usequeek.com/v1');
    }

    if (config.mode === 'external_sdk' && !config.clientKey) {
      throw new Error('clientKey is required when mode is external_sdk. Create a key under Settings, API keys in the dashboard.');
    }

    if (config.clientKey?.startsWith('sk_') && typeof window !== 'undefined' && typeof document !== 'undefined') {
      console.warn('Queek: a private sk_ key is configured in a browser. Anyone can read it. Use a pk_ public key here and keep sk_ keys on servers.');
    }

    this.platform = config.platform ?? DEFAULT_TOKEN_PLATFORM;
    this.authPrefix = (config.authPathPrefix ?? DEFAULT_AUTH_PREFIX).replace(/\/+$/, '');
    this.http = new QueekHttpClient({
      baseUrl: config.baseUrl,
      clientKey: config.clientKey,
      vendorSlug: config.vendorSlug,
      platform: DEFAULT_HEADER_PLATFORM,
      fetchFn,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? 0,
    });

    this.accessStorage = config.accessTokenStorage ?? new InMemoryStorageAdapter();
    this.refreshStorage = config.refreshTokenStorage ?? new InMemoryStorageAdapter();
    this.accessStorageKey = config.accessTokenStorageKey ?? DEFAULT_ACCESS_STORAGE_KEY;
    this.refreshStorageKey = config.refreshTokenStorageKey ?? DEFAULT_REFRESH_STORAGE_KEY;
    this.onUnauthenticated = config.onUnauthenticated;

    this.accessToken = this.accessStorage.getItem(this.accessStorageKey);
    this.refreshToken = this.refreshStorage.getItem(this.refreshStorageKey);
  }

  /**
   * Sends a request. On `401` it refreshes the session once and repeats the request once.
   *
   * @example
   * ```ts
   * const { data } = await client.request<{ name: string }>({ path: '/store/info' });
   * ```
   */
  async request<T>(config: QueekRequestConfig): Promise<ApiEnvelope<T>> {
    return this.requestWithAutoRefresh<T>(config, true);
  }

  /** `GET` a path. */
  async get<T>(path: string, options: QueekRequestOptions = {}): Promise<ApiEnvelope<T>> {
    return this.request<T>({ path, method: 'GET', ...options });
  }

  /** `POST` a JSON body. Pass `idempotencyKey` to make a retry safe. */
  async post<T>(path: string, body: unknown, options: QueekRequestOptions = {}): Promise<ApiEnvelope<T>> {
    return this.request<T>({ path, method: 'POST', body, ...options });
  }

  /** `PUT` a JSON body. */
  async put<T>(path: string, body: unknown, options: QueekRequestOptions = {}): Promise<ApiEnvelope<T>> {
    return this.request<T>({ path, method: 'PUT', body, ...options });
  }

  /** `PATCH` a JSON body. */
  async patch<T>(path: string, body: unknown, options: QueekRequestOptions = {}): Promise<ApiEnvelope<T>> {
    return this.request<T>({ path, method: 'PATCH', body, ...options });
  }

  /** `DELETE` a path. */
  async delete<T>(path: string, options: QueekRequestOptions = {}): Promise<ApiEnvelope<T>> {
    return this.request<T>({ path, method: 'DELETE', ...options });
  }

  /**
   * Walks a list endpoint one item at a time, following `next_cursor` until `has_more` is
   * `false`.
   *
   * @example
   * ```ts
   * for await (const product of client.paginate<{ name: string }>('/store/products', { limit: 50 })) {
   *   console.log(product.name);
   * }
   * ```
   */
  async *paginate<T>(path: string, options: QueekRequestOptions & { limit?: number } = {}): AsyncGenerator<T, void, undefined> {
    const { limit, ...requestOptions } = options;
    let cursor: string | null = null;

    for (;;) {
      const query: NonNullable<QueekRequestOptions['query']> = { ...requestOptions.query, limit };
      if (cursor !== null) {
        query.starting_after = cursor;
      }

      const page: ApiEnvelope<T[]> = await this.get<T[]>(path, { ...requestOptions, query });
      if (!Array.isArray(page.data)) {
        throw new QueekSdkError(
          `GET ${path} did not answer with a list, so it cannot be paginated.`,
          'invalid_response',
          200,
        );
      }

      yield* page.data;

      if (!page.has_more || !page.next_cursor || page.next_cursor === cursor) {
        return;
      }
      cursor = page.next_cursor;
    }
  }

  /**
   * Sends a one-time password to a phone by SMS or WhatsApp.
   *
   * @example
   * ```ts
   * await client.auth.requestOtp({ phone: '+14155552671', channel: 'whatsapp' });
   * ```
   */
  async requestOtp(payload: RequestOtpPayload): Promise<RequestOtpResponse> {
    const response = await this.post<RequestOtpResponse>(`${this.authPrefix}/phone/request-otp`, {
      phone: payload.phone,
      country_code: payload.countryCode,
      channel: payload.channel ?? 'sms',
    });

    return this.requireData(response, 'requestOtp');
  }

  /** Checks the phone code and signs the customer in. Stores the tokens. */
  async verifyOtp(payload: VerifyOtpPayload): Promise<VerifyOtpResponse> {
    const response = await this.post<VerifyOtpResponse>(`${this.authPrefix}/phone/verify-otp`, {
      phone: payload.phone,
      country_code: payload.countryCode,
      otp_code: payload.otpCode,
      platform: payload.platform ?? this.platform,
    });
    const data = this.requireData(response, 'verifyOtp');

    this.persistTokens(data.access_token, data.refresh_token);

    return data;
  }

  /** Creates a customer account from a verified phone code and signs them in. Stores the tokens. */
  async register(payload: RegisterPayload): Promise<RegisterResponse> {
    const response = await this.post<RegisterResponse>(`${this.authPrefix}/register`, {
      first_name: payload.firstName,
      last_name: payload.lastName,
      email: payload.email,
      phone: payload.phone,
      country_code: payload.countryCode,
      otp_code: payload.otpCode,
      username: payload.username,
      platform: payload.platform ?? this.platform,
    });
    const data = this.requireData(response, 'register');

    this.persistTokens(data.access_token, data.refresh_token);

    return data;
  }

  /** Sends a six-digit one-time password to an email address. */
  async emailRequestOtp(payload: EmailRequestOtpPayload): Promise<EmailRequestOtpResponse> {
    const response = await this.post<EmailRequestOtpResponse>(`${this.authPrefix}/email/request-otp`, {
      email: payload.email,
    });

    return this.requireData(response, 'emailRequestOtp');
  }

  /**
   * Checks the email code. An existing customer is signed in and the tokens are stored. A new
   * customer gets `{ needs_registration: true, verified_token }`: pass the token to
   * `emailRegisterOtp` to create the account.
   */
  async emailVerifyOtp(payload: EmailVerifyOtpPayload): Promise<EmailVerifyOtpResponse> {
    const response = await this.post<EmailVerifyOtpResponse>(`${this.authPrefix}/email/verify-otp`, {
      email: payload.email,
      otp_code: payload.otpCode,
      platform: payload.platform ?? this.platform,
    });
    const data = this.requireData(response, 'emailVerifyOtp');

    if (!data.needs_registration) {
      this.persistTokens(data.access_token, data.refresh_token);
    }

    return data;
  }

  /** Finishes registration after `emailVerifyOtp`. The `verifiedToken` is single use. Stores the tokens. */
  async emailRegisterOtp(payload: EmailRegisterOtpPayload): Promise<EmailRegisterOtpResponse> {
    const response = await this.post<EmailRegisterOtpResponse>(`${this.authPrefix}/email/register-otp`, {
      first_name: payload.firstName,
      last_name: payload.lastName,
      verified_token: payload.verifiedToken,
      platform: payload.platform ?? this.platform,
    });
    const data = this.requireData(response, 'emailRegisterOtp');

    this.persistTokens(data.access_token, data.refresh_token);

    return data;
  }

  /** Exchanges the stored refresh token for a new token pair. Concurrent calls share one request. */
  async refresh(): Promise<RefreshResponse> {
    return this.refreshWithLock();
  }

  /** Returns the signed-in customer. */
  async me(): Promise<MeResponse> {
    const response = await this.get<MeResponse>(`${this.authPrefix}/me`);

    return this.requireData(response, 'me');
  }

  /** Ends the session. The local tokens are cleared even when the server call fails. */
  async logout(): Promise<void> {
    const refreshToken = this.refreshToken;
    try {
      await this.post<Record<string, never>>(
        `${this.authPrefix}/logout`,
        refreshToken ? { refresh_token: refreshToken } : {},
      );
    } finally {
      this.clearTokens();
    }
  }

  /** `true` when the client holds an access or a refresh token. It does not check that they are still valid. */
  isAuthenticated(): boolean {
    return Boolean(this.accessToken || this.refreshToken);
  }

  /** The current access token, or `null`. */
  getAccessToken(): string | null {
    return this.accessToken;
  }

  private requireData<T>(response: ApiEnvelope<T>, operation: string): T {
    if (response.data === null || response.data === undefined) {
      throw new QueekSdkError(
        `${operation} succeeded but the reply had no data. Check that baseUrl and authPathPrefix point at the Queek API.`,
        'invalid_response',
        200,
      );
    }

    return response.data;
  }

  private async requestWithAutoRefresh<T>(config: QueekRequestConfig, canRetry: boolean): Promise<ApiEnvelope<T>> {
    try {
      return await this.http.request<T>({
        path: config.path,
        method: config.method ?? 'GET',
        body: config.body,
        headers: config.headers,
        query: config.query,
        signal: config.signal,
        timeoutMs: config.timeoutMs,
        maxRetries: config.maxRetries,
        idempotencyKey: config.idempotencyKey,
        requestId: config.requestId,
        accessToken: this.accessToken,
      });
    } catch (error) {
      if (!this.shouldRefresh(error, config, canRetry)) {
        // No way to recover the session: tell the host, except for the sign-in
        // routes themselves, where a 401 is the answer to the call.
        if (error instanceof QueekSdkError && error.status === 401 && !this.isAuthPath(config.path)) {
          this.onUnauthenticated?.({ path: config.path, error });
        }
        throw error;
      }

      try {
        await this.refreshWithLock();
      } catch (refreshError) {
        this.clearTokens();
        const normalized = this.toNormalizedAuthError(refreshError);
        if (!this.isAuthPath(config.path)) {
          this.onUnauthenticated?.({ path: config.path, error: normalized });
        }
        throw normalized;
      }

      return this.requestWithAutoRefresh<T>({
        ...config,
        retryOnUnauthorized: false,
      }, false);
    }
  }

  private shouldRefresh(error: unknown, config: QueekRequestConfig, canRetry: boolean): boolean {
    if (!canRetry || config.retryOnUnauthorized === false) {
      return false;
    }

    if (!this.refreshToken || this.isSignInPath(config.path)) {
      return false;
    }

    if (!(error instanceof QueekSdkError)) {
      return false;
    }

    return error.status === 401;
  }

  private normalizePath(path: string): string {
    return path.toLowerCase().split('?')[0].replace(/\/+$/, '');
  }

  private isAuthPath(path: string): boolean {
    return `${this.normalizePath(path)}/`.includes(`${this.authPrefix.toLowerCase()}/`);
  }

  private isSignInPath(path: string): boolean {
    const normalized = this.normalizePath(path);
    const prefix = this.authPrefix.toLowerCase();

    return SIGN_IN_ROUTES.some((route) => {
      const suffix = `${prefix}${route}`;

      return route.endsWith('/') ? normalized.includes(suffix) : normalized.endsWith(suffix);
    });
  }

  private async refreshInternal(): Promise<RefreshResponse> {
    if (!this.refreshToken) {
      throw new QueekSdkError(
        'There is no refresh token to renew the session with. Sign the customer in again.',
        'invalid_refresh_token',
        401,
      );
    }

    const response = await this.http.request<RefreshResponse>({
      path: `${this.authPrefix}/token/refresh`,
      method: 'POST',
      body: {
        refresh_token: this.refreshToken,
        platform: this.platform,
      },
      accessToken: this.accessToken,
    });
    const data = this.requireData(response, 'refresh');

    this.persistTokens(data.access_token, data.refresh_token);

    return data;
  }

  private async refreshWithLock(): Promise<RefreshResponse> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.refreshInternal().finally(() => {
      this.refreshPromise = null;
    });

    return this.refreshPromise;
  }

  private toNormalizedAuthError(cause: unknown): QueekSdkError {
    return new QueekSdkError(
      'The session has expired and could not be renewed. Sign the customer in again.',
      'unauthenticated',
      401,
      cause,
      { cause, requestId: cause instanceof QueekSdkError ? cause.requestId : undefined },
    );
  }

  private persistTokens(accessToken: string, refreshToken: string): void {
    this.accessToken = accessToken;
    this.refreshToken = refreshToken;

    this.accessStorage.setItem(this.accessStorageKey, accessToken);
    this.refreshStorage.setItem(this.refreshStorageKey, refreshToken);
  }

  private clearTokens(): void {
    this.accessToken = null;
    this.refreshToken = null;

    this.accessStorage.removeItem(this.accessStorageKey);
    this.refreshStorage.removeItem(this.refreshStorageKey);
  }
}
