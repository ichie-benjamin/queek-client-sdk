import type { StorageAdapter } from './types.js';

/**
 * Default token storage, held in memory. Tokens are lost on reload. To keep a session
 * across reloads, pass a `localStorage`-backed adapter as `accessTokenStorage` and
 * `refreshTokenStorage`.
 */
export class InMemoryStorageAdapter implements StorageAdapter {
  private readonly store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }
}
