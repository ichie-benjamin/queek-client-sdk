import { QueekClientAuth } from './auth.js';
import { InMemoryStorageAdapter } from './storage.js';
import type {
  ApiEnvelope,
  QueekClientConfig,
  QueekRequestConfig,
  QueekRequestOptions,
} from './types.js';

export interface QueekClientInstance {
  auth: Pick<
    QueekClientAuth,
    'requestOtp' | 'verifyOtp' | 'register' | 'refresh' | 'me' | 'logout' | 'isAuthenticated' | 'getAccessToken'
  >;
  get<T>(path: string, options?: QueekRequestOptions): Promise<ApiEnvelope<T>>;
  post<T>(path: string, body: unknown, options?: QueekRequestOptions): Promise<ApiEnvelope<T>>;
  put<T>(path: string, body: unknown, options?: QueekRequestOptions): Promise<ApiEnvelope<T>>;
  delete<T>(path: string, options?: QueekRequestOptions): Promise<ApiEnvelope<T>>;
  request<T>(config: QueekRequestConfig): Promise<ApiEnvelope<T>>;
}

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
    delete: runtime.delete.bind(runtime),
    request: runtime.request.bind(runtime),
  };
}

export { QueekClientAuth } from './auth.js';
export { QueekSdkError } from './http.js';
export { InMemoryStorageAdapter } from './storage.js';
export type {
  ApiEnvelope,
  ClientAuthUser,
  MeResponse,
  RegisterPayload,
  RegisterResponse,
  QueekChannel,
  QueekClientConfig,
  QueekErrorCode,
  QueekHttpMethod,
  QueekRequestConfig,
  QueekRequestOptions,
  RefreshResponse,
  RequestOtpPayload,
  RequestOtpResponse,
  StorageAdapter,
  TokenPayload,
  VerifyOtpPayload,
  VerifyOtpResponse,
} from './types.js';
