/** Delivery channel for a phone one-time password. */
export type QueekChannel = 'sms' | 'whatsapp';

/**
 * Stable machine codes. `QueekSdkError.code` is one of these for every failure the
 * SDK knows about, and the raw `error.code` string from the API otherwise. Branch on
 * the code, never on the message.
 */
export type QueekErrorCode =
  // Sign-in and account
  | 'invalid_phone'
  | 'invalid_email'
  | 'invalid_username'
  | 'otp_send_failed'
  | 'otp_resend_too_soon'
  | 'invalid_otp'
  | 'expired_otp'
  | 'invalid_credentials'
  | 'login_mode_mismatch'
  | 'client_not_allowed'
  | 'invalid_refresh_token'
  | 'refresh_token_expired'
  | 'unauthenticated'
  | 'account_not_found'
  | 'account_already_exists'
  | 'account_not_allowed'
  // Keys and origins
  | 'client_key_required'
  | 'invalid_client_key'
  | 'api_key_mode_mismatch'
  | 'origin_required'
  | 'origin_not_allowed'
  | 'plan_inactive'
  | 'route_not_available'
  // Request shape and platform defaults
  | 'bad_request'
  | 'forbidden'
  | 'not_found'
  | 'validation_failed'
  | 'idempotency_key_reuse'
  | 'idempotency_key_in_progress'
  | 'too_many_requests'
  | 'server_error'
  | 'service_unavailable'
  // Raised by the SDK itself, before or instead of an API answer
  | 'network_error'
  | 'timeout'
  | 'aborted'
  | 'invalid_response'
  | 'unknown_error';

/** Where the SDK keeps the session tokens. `localStorage` fits this shape. */
export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** What `onUnauthenticated` receives when a session cannot be recovered. */
export interface UnauthenticatedContext {
  /** The path of the request that was refused. */
  path: string;
  error: import('./http.js').QueekSdkError;
}

/** Options for {@link createQueekClient}. */
export interface QueekClientConfig {
  /**
   * API base URL, without a trailing path for the resource. Example:
   * `https://client.usequeek.com/v1`. A same-origin relative base such as `/api/v1`
   * is accepted when a proxy forwards to the API.
   */
  baseUrl: string;
  /**
   * The store's API key. A `pk_` public key is for browsers; an `sk_` private key is for
   * servers only and must never be shipped in a bundle.
   */
  clientKey?: string;
  /** Selects the store when the host serves more than one. */
  vendorSlug?: string;
  /** `external_sdk` makes `clientKey` required at construction. */
  mode?: 'auto' | 'hosted_storefront' | 'external_sdk';
  /** A `fetch` implementation. Defaults to the global one. */
  fetch?: typeof fetch;
  refreshTokenStorage?: StorageAdapter;
  accessTokenStorage?: StorageAdapter;
  accessTokenStorageKey?: string;
  refreshTokenStorageKey?: string;
  /** The `platform` value sent when signing in. Defaults to `client_web`. */
  platform?: string;
  /**
   * Path of the customer sign-in routes under `baseUrl`. Defaults to `/client/auth`.
   * Use `/auth` against the public gateway, where the routes have no `client` segment.
   */
  authPathPrefix?: string;
  /** Per-request timeout in milliseconds. Defaults to 30000. `0` disables it. */
  timeoutMs?: number;
  /**
   * How many times to retry a request that failed with a network error, `429`, `502`,
   * `503` or `504`. Only `GET` requests and writes that carry an `idempotencyKey` are
   * retried. Defaults to `0`.
   */
  maxRetries?: number;
  /**
   * Called when a request gets `401` and the SDK cannot recover the session (no refresh
   * token, or the refresh failed). Tokens are already cleared when it runs.
   */
  onUnauthenticated?: (context: UnauthenticatedContext) => void;
}

export interface RequestOtpPayload {
  phone: string;
  countryCode?: string;
  channel?: QueekChannel;
}

export interface VerifyOtpPayload {
  phone: string;
  countryCode?: string;
  otpCode: string;
  platform?: string;
}

export interface RegisterPayload {
  firstName: string;
  lastName?: string;
  email: string;
  phone: string;
  countryCode?: string;
  otpCode: string;
  username?: string;
  platform?: string;
}

export interface ClientAuthUser {
  id: string;
  first_name: string | null;
  last_name: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  avatar: string | null;
  status: string | null;
}

export interface TokenPayload {
  token_type: string;
  access_token: string;
  expires_in: number;
  expires_at: string;
  refresh_token: string;
  refresh_expires_in: number;
  refresh_expires_at: string;
  platform: string;
}

export interface RequestOtpResponse {
  next_action: 'verify_otp';
  phone: string;
  user_exists: boolean;
  expires_in: number;
  resend_in: number;
  /** Present only on dev stores. */
  debug_code?: string;
}

export type VerifyOtpResponse = TokenPayload & { user: ClientAuthUser };
export type RegisterResponse = TokenPayload & { user: ClientAuthUser };
export type RefreshResponse = TokenPayload & { user: ClientAuthUser };
export type MeResponse = { user: ClientAuthUser };

export interface EmailRequestOtpPayload {
  email: string;
}

export interface EmailRequestOtpResponse {
  next_action: 'verify_otp';
  email: string;
  user_exists: boolean;
  expires_in: number;
  resend_in: number;
}

export interface EmailVerifyOtpPayload {
  email: string;
  otpCode: string;
  platform?: string;
}

/**
 * The code was valid. For an existing customer the answer is a signed-in session. For a
 * new one it is `needs_registration: true` and a `verified_token` to pass to
 * `emailRegisterOtp`.
 */
export type EmailVerifyOtpResponse =
  | (TokenPayload & { user: ClientAuthUser; needs_registration?: false })
  | { needs_registration: true; verified_token: string };

export interface EmailRegisterOtpPayload {
  firstName: string;
  lastName?: string;
  verifiedToken: string;
  platform?: string;
}

export type EmailRegisterOtpResponse = TokenPayload & {
  user: ClientAuthUser;
  is_new_user: true;
};

/** The success envelope every endpoint answers with. */
export interface ApiEnvelope<T> {
  status: string;
  message: string;
  data: T;
  /** Context beside a list page: filters, the category it belongs to. */
  meta?: Record<string, unknown>;
  /** List endpoints only: another page follows. */
  has_more?: boolean;
  /** List endpoints only: pass as `starting_after` to read the next page. */
  next_cursor?: string | null;
}

/** The failure envelope. `error` is an object on current endpoints and a string on older ones. */
export interface ApiErrorBody {
  status?: string;
  message?: string;
  error_code?: string;
  request_id?: string;
  doc_url?: string;
  error?:
    | string
    | {
        code?: string;
        message?: string;
        field?: string;
        errors?: Record<string, string[]>;
        doc_url?: string;
        request_id?: string;
      };
  data?: unknown;
}

export type QueekHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** A query-string value. `null` and `undefined` are left out. Arrays repeat the key. */
export type QueekQueryValue = string | number | boolean | null | undefined;
export type QueekQuery = Record<string, QueekQueryValue | readonly QueekQueryValue[]>;

/** Per-request options accepted by every verb. */
export interface QueekRequestOptions {
  headers?: Record<string, string>;
  /** Query-string parameters, encoded for you. */
  query?: QueekQuery;
  /** Set to `false` to skip the refresh-and-retry that follows a `401`. */
  retryOnUnauthorized?: boolean;
  /** Cancels the request. The call rejects with code `aborted`. */
  signal?: AbortSignal;
  /** Overrides the client's `timeoutMs` for this request. */
  timeoutMs?: number;
  /** Overrides the client's `maxRetries` for this request. */
  maxRetries?: number;
  /** Sent as `Idempotency-Key`. A retry with the same key and body cannot act twice. */
  idempotencyKey?: string;
  /** Sent as `X-Request-Id` (8 to 128 characters of `A-Za-z0-9_.:-`) to correlate with Queek's logs. */
  requestId?: string;
}

export interface QueekRequestConfig extends QueekRequestOptions {
  path: string;
  method?: QueekHttpMethod;
  body?: unknown;
}

/** Options for `client.paginate`. */
export interface QueekPaginateOptions extends QueekRequestOptions {
  /** Page size. The API caps it at 100. */
  limit?: number;
}
