# Queek Client SDK

A small, typed JavaScript client for the Queek Storefront API: customer sign-in, a session that renews itself, and `get`, `post`, `put`, `patch` and `delete` calls with timeouts, retries, idempotency keys and cursor pagination.

It has no dependencies. It uses the platform `fetch`, so it runs in browsers, Node.js 18 or later, and edge runtimes.

The SDK does not model each endpoint. You pass a path from the [Storefront API reference](https://docs.usequeek.com/docs/storefront) and read the typed envelope that comes back. For the Merchant API and webhook verification, use [`@usequeek/app-sdk`](https://www.npmjs.com/package/@usequeek/app-sdk).

## Install

```bash
npm install @usequeek/client-sdk
```

This package was published as `@queekai/client-sdk` up to 0.3.1. The API is unchanged; switch the package name in your `package.json` and imports.

## Quickstart

Create a key in the Queek dashboard under **Settings, API keys**. Use a `pk_` public key in browser code. Use an `sk_` private key only on a server.

```ts
import { createQueekClient } from '@usequeek/client-sdk';

const client = createQueekClient({
  baseUrl: 'https://client.usequeek.com/v1',
  clientKey: 'pk_live_your_key_here',
  authPathPrefix: '/auth',
});

const { data: store } = await client.get<{ name: string; currency: string }>('/store/info');
console.log(store.name, store.currency);

for await (const product of client.paginate<{ name: string }>('/store/products', { limit: 50 })) {
  console.log(product.name);
}
```

`authPathPrefix: '/auth'` points the sign-in helpers at the routes the public reference lists under `/auth`. Leave it out when `baseUrl` is an API host whose sign-in routes live under `/client/auth`, which is the default.

## Sign a customer in

Sign-in uses a one-time password sent by SMS, WhatsApp or email. On success the SDK keeps the tokens and attaches them to every later request.

```ts
import { QueekSdkError } from '@usequeek/client-sdk';

await client.auth.requestOtp({ phone: '+14155552671', channel: 'sms' });

try {
  await client.auth.verifyOtp({ phone: '+14155552671', otpCode: '123456' });
} catch (error) {
  if (error instanceof QueekSdkError && error.code === 'account_not_found') {
    await client.auth.register({
      firstName: 'Ada',
      email: 'ada@example.com',
      phone: '+14155552671',
      otpCode: '123456',
    });
  } else {
    throw error;
  }
}

const { user } = await client.auth.me();
await client.auth.logout();
```

The email flow is `emailRequestOtp`, then `emailVerifyOtp`. For a new customer `emailVerifyOtp` returns `{ needs_registration: true, verified_token }`; pass the token to `emailRegisterOtp`.

When a request gets `401` and a refresh token is stored, the SDK renews the session once and repeats the request once. If the renewal fails, the tokens are cleared, the call rejects with code `unauthenticated`, and `onUnauthenticated` runs so your app can show the sign-in screen.

Tokens live in memory by default and are lost on reload. To keep a session, pass a `localStorage`-backed adapter:

```ts
const storage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => localStorage.setItem(key, value),
  removeItem: (key: string) => localStorage.removeItem(key),
};

createQueekClient({ baseUrl, clientKey, accessTokenStorage: storage, refreshTokenStorage: storage });
```

## Requests

| Call | What it does |
| --- | --- |
| `client.get(path, options?)` | Read. |
| `client.post(path, body, options?)` | Create or act. |
| `client.put(path, body, options?)` | Replace. |
| `client.patch(path, body, options?)` | Update fields. |
| `client.delete(path, options?)` | Remove. |
| `client.request(config)` | Any of the above from one object. |
| `client.paginate(path, options?)` | Async iterator over every item of a list, following `next_cursor`. |

Options accepted by every call:

| Option | Effect |
| --- | --- |
| `query` | Query parameters, encoded for you. `null` and `undefined` are left out. An array repeats the key. |
| `headers` | Extra headers, for example `X-Cart-Session` for a shopper's cart. |
| `signal` | An `AbortSignal` that cancels the call. |
| `timeoutMs` | Overrides the client timeout for this call. |
| `maxRetries` | Overrides the client retry count for this call. |
| `idempotencyKey` | Sent as `Idempotency-Key`. A retry with the same key and body cannot act twice. |
| `requestId` | Sent as `X-Request-Id`, so you can find the call in Queek's logs. |
| `retryOnUnauthorized` | Set to `false` to skip the refresh that follows a `401`. |

Client options, besides `baseUrl` and `clientKey`:

| Option | Default | Effect |
| --- | --- | --- |
| `timeoutMs` | `30000` | Per-request timeout. `0` turns it off. |
| `maxRetries` | `0` | Retries after a network error, `429`, `502`, `503` or `504`. Waits for `Retry-After` when the API sends it, otherwise backs off with jitter. |
| `authPathPrefix` | `/client/auth` | Where the sign-in routes live under `baseUrl`. |
| `fetch` | global `fetch` | Your own implementation, for runtimes without one or for tests. |
| `platform` | `client_web` | The `platform` value sent when signing in. |
| `vendorSlug` | none | Sent as `X-Vendor-Slug` to hosts that serve more than one store. |
| `onUnauthenticated` | none | Called when a session cannot be renewed. |

Retries apply to `GET` requests, and to writes that carry an `idempotencyKey`. A write without a key is never retried, because it could run twice.

```ts
await client.post(
  '/store/cart/items',
  { product_id: 'the-id-from-a-listing', quantity: 1 },
  { headers: { 'X-Cart-Session': cartSession }, idempotencyKey: crypto.randomUUID(), maxRetries: 2 },
);
```

## Errors

Every failure is a `QueekSdkError`. Branch on `code`, which is stable. The message is for people and may change.

| Property | Meaning |
| --- | --- |
| `code` | The API's `error.code`, such as `invalid_client_key` or `validation_failed`, or one the SDK raises itself. |
| `status` | The HTTP status. `0` when no answer arrived. |
| `requestId` | The `X-Request-Id` of the call. Quote it when you contact support. |
| `docUrl` | Link to the code's entry in the error reference. |
| `field`, `errors` | The offending field and per-field messages, on validation failures. |
| `retryAfterMs` | How long the API asked you to wait, when it said. |
| `retryable` | `true` for no answer, `429`, `502`, `503` and `504`. |
| `cause` | The underlying error, for network failures and failed renewals. |

Codes the SDK raises itself: `network_error` (no answer), `timeout`, `aborted` (your `AbortSignal` fired) and `invalid_response` (a success answer that is not the expected JSON, usually a wrong `baseUrl`). The API's own codes are listed in [Versioning and errors](https://docs.usequeek.com/docs/versioning-and-errors).

## Security

- An `sk_` key can read and change store data. Keep it on servers. The SDK prints a warning if it sees one in a browser.
- The SDK never writes your key into an error message.
- Stored tokens are bearer credentials. Prefer the default in-memory storage on shared devices.

## Versioning

The package follows semantic versioning and is at `0.x`: minor releases may change the public surface, and the changes are listed in [CHANGELOG.md](CHANGELOG.md). The API it talks to has one major version, `v1`, which only grows.

## Develop

```bash
npm ci
npm run lint    # type-checks src/
npm run build
npm test        # builds, then runs tests/*.test.mjs with the Node test runner
```

Issues and questions: [developers@usequeek.com](mailto:developers@usequeek.com).

## License

MIT. Copyright Queekx Technology LTD. See [LICENSE](LICENSE).
