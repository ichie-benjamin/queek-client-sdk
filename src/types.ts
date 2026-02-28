export type QueekChannel = 'sms' | 'whatsapp';

export type QueekErrorCode =
  | 'invalid_phone'
  | 'otp_send_failed'
  | 'invalid_otp'
  | 'expired_otp'
  | 'client_not_allowed'
  | 'invalid_refresh_token'
  | 'refresh_token_expired'
  | 'unauthenticated'
  | 'account_not_found'
  | 'too_many_requests'
  | 'unknown_error';

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface QueekClientConfig {
  // Use API base root (example: https://api.queek.com.ng/api/v1)
  baseUrl: string;
  clientKey: string;
  fetch?: typeof fetch;
  refreshTokenStorage?: StorageAdapter;
  accessTokenStorage?: StorageAdapter;
  accessTokenStorageKey?: string;
  refreshTokenStorageKey?: string;
  platform?: string;
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
  debug_code?: string;
}

export type VerifyOtpResponse = TokenPayload & { user: ClientAuthUser };
export type RefreshResponse = TokenPayload & { user: ClientAuthUser };
export type MeResponse = { user: ClientAuthUser };

export interface ApiEnvelope<T> {
  status: string;
  message: string;
  data: T;
}

export interface ApiErrorBody {
  status?: string;
  message?: string;
  error_code?: string;
  error?: string;
  data?: unknown;
}

export type QueekHttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface QueekRequestOptions {
  headers?: Record<string, string>;
  retryOnUnauthorized?: boolean;
}

export interface QueekRequestConfig extends QueekRequestOptions {
  path: string;
  method?: QueekHttpMethod;
  body?: unknown;
}
