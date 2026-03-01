import { QueekHttpClient, QueekSdkError } from './http.js';
import { InMemoryStorageAdapter } from './storage.js';
import type {
  ApiEnvelope,
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
const DEFAULT_ACCESS_STORAGE_KEY = 'queek_client_access_token';
const DEFAULT_REFRESH_STORAGE_KEY = 'queek_client_refresh_token';

export class QueekClientAuth {
  private readonly http: QueekHttpClient;
  private readonly accessStorage;
  private readonly refreshStorage;
  private readonly accessStorageKey: string;
  private readonly refreshStorageKey: string;
  private readonly platform: string;

  private accessToken: string | null;
  private refreshToken: string | null;
  private refreshPromise: Promise<RefreshResponse> | null = null;

  constructor(config: QueekClientConfig) {
    const fetchFn = config.fetch ?? globalThis.fetch?.bind(globalThis);

    if (!fetchFn) {
      throw new Error('No fetch implementation available. Provide config.fetch in non-browser environments.');
    }

    if (config.mode === 'external_sdk' && !config.clientKey) {
      throw new Error('clientKey is required when mode is external_sdk.');
    }

    this.http = new QueekHttpClient({
      baseUrl: config.baseUrl,
      clientKey: config.clientKey,
      vendorSlug: config.vendorSlug,
      fetchFn,
    });

    this.accessStorage = config.accessTokenStorage ?? new InMemoryStorageAdapter();
    this.refreshStorage = config.refreshTokenStorage ?? new InMemoryStorageAdapter();
    this.accessStorageKey = config.accessTokenStorageKey ?? DEFAULT_ACCESS_STORAGE_KEY;
    this.refreshStorageKey = config.refreshTokenStorageKey ?? DEFAULT_REFRESH_STORAGE_KEY;
    this.platform = config.platform ?? 'client_web';

    this.accessToken = this.accessStorage.getItem(this.accessStorageKey);
    this.refreshToken = this.refreshStorage.getItem(this.refreshStorageKey);
  }

  async request<T>(config: QueekRequestConfig): Promise<ApiEnvelope<T>> {
    return this.requestWithAutoRefresh<T>(config, true);
  }

  async get<T>(path: string, options: QueekRequestOptions = {}): Promise<ApiEnvelope<T>> {
    return this.request<T>({
      path,
      method: 'GET',
      ...options,
    });
  }

  async post<T>(path: string, body: unknown, options: QueekRequestOptions = {}): Promise<ApiEnvelope<T>> {
    return this.request<T>({
      path,
      method: 'POST',
      body,
      ...options,
    });
  }

  async put<T>(path: string, body: unknown, options: QueekRequestOptions = {}): Promise<ApiEnvelope<T>> {
    return this.request<T>({
      path,
      method: 'PUT',
      body,
      ...options,
    });
  }

  async delete<T>(path: string, options: QueekRequestOptions = {}): Promise<ApiEnvelope<T>> {
    return this.request<T>({
      path,
      method: 'DELETE',
      ...options,
    });
  }

  async requestOtp(payload: RequestOtpPayload): Promise<RequestOtpResponse> {
    const response = await this.post<RequestOtpResponse>(`${DEFAULT_AUTH_PREFIX}/phone/request-otp`, {
      phone: payload.phone,
      country_code: payload.countryCode,
      channel: payload.channel ?? 'sms',
    });

    return response.data;
  }

  async verifyOtp(payload: VerifyOtpPayload): Promise<VerifyOtpResponse> {
    const response = await this.post<VerifyOtpResponse>(`${DEFAULT_AUTH_PREFIX}/phone/verify-otp`, {
      phone: payload.phone,
      country_code: payload.countryCode,
      otp_code: payload.otpCode,
      platform: payload.platform ?? this.platform,
    });

    this.persistTokens(response.data.access_token, response.data.refresh_token);

    return response.data;
  }

  async register(payload: RegisterPayload): Promise<RegisterResponse> {
    const response = await this.post<RegisterResponse>(`${DEFAULT_AUTH_PREFIX}/register`, {
      first_name: payload.firstName,
      last_name: payload.lastName,
      email: payload.email,
      phone: payload.phone,
      country_code: payload.countryCode,
      otp_code: payload.otpCode,
      username: payload.username,
      platform: payload.platform ?? this.platform,
    });

    this.persistTokens(response.data.access_token, response.data.refresh_token);

    return response.data;
  }

  async refresh(): Promise<RefreshResponse> {
    return this.refreshWithLock();
  }

  async me(): Promise<MeResponse> {
    const response = await this.get<MeResponse>(`${DEFAULT_AUTH_PREFIX}/me`);

    return response.data;
  }

  async logout(): Promise<void> {
    const refreshToken = this.refreshToken;
    try {
      await this.post<Record<string, never>>(
        `${DEFAULT_AUTH_PREFIX}/logout`,
        refreshToken ? { refresh_token: refreshToken } : {},
      );
    } finally {
      this.clearTokens();
    }
  }

  isAuthenticated(): boolean {
    return Boolean(this.accessToken || this.refreshToken);
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  private async requestWithAutoRefresh<T>(config: QueekRequestConfig, canRetry: boolean): Promise<ApiEnvelope<T>> {
    try {
      return await this.http.request<T>({
        path: config.path,
        method: config.method ?? 'GET',
        body: config.body,
        headers: config.headers,
        accessToken: this.accessToken,
      });
    } catch (error) {
      if (!this.shouldRefresh(error, config, canRetry)) {
        throw error;
      }

      try {
        await this.refreshWithLock();
      } catch (refreshError) {
        this.clearTokens();
        throw this.toNormalizedAuthError(refreshError);
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

    if (!this.refreshToken || this.isRefreshPath(config.path)) {
      return false;
    }

    if (!(error instanceof QueekSdkError)) {
      return false;
    }

    return error.status === 401;
  }

  private isRefreshPath(path: string): boolean {
    const normalized = path.toLowerCase().split('?')[0].replace(/\/+$/, '');

    return (
      normalized.endsWith('/client/auth/token/refresh')
    );
  }

  private async refreshInternal(): Promise<RefreshResponse> {
    if (!this.refreshToken) {
      throw new QueekSdkError('Refresh token is missing.', 'invalid_refresh_token', 401);
    }

    const response = await this.http.request<RefreshResponse>({
      path: `${DEFAULT_AUTH_PREFIX}/token/refresh`,
      method: 'POST',
      body: {
        refresh_token: this.refreshToken,
        platform: this.platform,
      },
      accessToken: this.accessToken,
    });

    this.persistTokens(response.data.access_token, response.data.refresh_token);

    return response.data;
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
      'Authentication required. Please login again.',
      'unauthenticated',
      401,
      cause,
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
