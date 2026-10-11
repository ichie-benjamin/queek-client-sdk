import { QueekClientAuth } from './auth.js';
import { InMemoryStorageAdapter } from './storage.js';
import type {
  ApiEnvelope,
  QueekClientConfig,
  QueekPaginateOptions,
  QueekRequestConfig,
  QueekRequestOptions,
} from './types.js';

/**
 * A configured Queek client. Every call resolves with the API's success envelope and
 * rejects with a {@link QueekSdkError}.
 */
export interface QueekClientInstance {
  /** Customer sign-in (phone or email one-time password), session, and sign-out. */
  auth: Pick<
    QueekClientAuth,
    | 'requestOtp'
    | 'verifyOtp'
    | 'register'
    | 'emailRequestOtp'
    | 'emailVerifyOtp'
    | 'emailRegisterOtp'
    | 'refresh'
    | 'me'
    | 'logout'
    | 'isAuthenticated'
    | 'getAccessToken'
  >;
  /** `GET` a path. A `401` refreshes the session once and repeats the call. */
  get<T>(path: string, options?: QueekRequestOptions): Promise<ApiEnvelope<T>>;
  /** `POST` a JSON body. */
  post<T>(path: string, body: unknown, options?: QueekRequestOptions): Promise<ApiEnvelope<T>>;
  /** `PUT` a JSON body. */
  put<T>(path: string, body: unknown, options?: QueekRequestOptions): Promise<ApiEnvelope<T>>;
  /** `PATCH` a JSON body. */
  patch<T>(path: string, body: unknown, options?: QueekRequestOptions): Promise<ApiEnvelope<T>>;
  /** `DELETE` a path. */
  delete<T>(path: string, options?: QueekRequestOptions): Promise<ApiEnvelope<T>>;
  /** Send a request described by one object. */
  request<T>(config: QueekRequestConfig): Promise<ApiEnvelope<T>>;
  /** Iterate every item of a list endpoint, following the cursor page by page. */
  paginate<T>(path: string, options?: QueekPaginateOptions): AsyncGenerator<T, void, undefined>;
}

/**
 * Creates a Queek client. This is the entry point.
 *
 * @example
 * ```ts
 * const client = createQueekClient({
 *   baseUrl: 'https://client.usequeek.com/v1',
 *   clientKey: 'pk_live_your_key_here',
 *   authPathPrefix: '/auth',
 * });
 * const { data } = await client.get<{ name: string }>('/store/info');
 * ```
 */
export function createQueekClient(config: QueekClientConfig): QueekClientInstance {
  const mergedConfig: QueekClientConfig = {
    ...config,
    accessTokenStorage: config.accessTokenStorage ?? new InMemoryStorageAdapter(),
    refreshTokenStorage: config.refreshTokenStorage ?? new InMemoryStorageAdapter(),
  };

  const runtime = new QueekClientAuth(mergedConfig);

  return {
    auth: runtime,
    get: runtime.get.bind(runtime),
    post: runtime.post.bind(runtime),
    put: runtime.put.bind(runtime),
    patch: runtime.patch.bind(runtime),
    delete: runtime.delete.bind(runtime),
    request: runtime.request.bind(runtime),
    paginate: runtime.paginate.bind(runtime),
  };
}

export { QueekClientAuth } from './auth.js';
export { QueekSdkError } from './http.js';
export type { QueekSdkErrorOptions } from './http.js';
export { InMemoryStorageAdapter } from './storage.js';
export type {
  ApiEnvelope,
  ClientAuthUser,
  EmailRegisterOtpPayload,
  EmailRegisterOtpResponse,
  EmailRequestOtpPayload,
  EmailRequestOtpResponse,
  EmailVerifyOtpPayload,
  EmailVerifyOtpResponse,
  MeResponse,
  RegisterPayload,
  RegisterResponse,
  QueekChannel,
  QueekClientConfig,
  QueekErrorCode,
  QueekHttpMethod,
  QueekPaginateOptions,
  QueekQuery,
  QueekQueryValue,
  QueekRequestConfig,
  QueekRequestOptions,
  RefreshResponse,
  RequestOtpPayload,
  RequestOtpResponse,
  StorageAdapter,
  TokenPayload,
  UnauthenticatedContext,
  VerifyOtpPayload,
  VerifyOtpResponse,
} from './types.js';
