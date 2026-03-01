# Queek Client SDK

Lightweight browser-friendly SDK for `/api/v1/client/auth/*`.

## Install

```bash
npm install @queekai/client-sdk
```

## Build

```bash
npm run lint
npm run build
npm test
```

## Usage

```ts
import { createQueekClient, QueekSdkError } from '@queekai/client-sdk';

// External self-hosted storefront (requires client key)
const client = createQueekClient({
  baseUrl: 'https://api.queek.com.ng/api/v1',
  clientKey: 'qck_client_public_key_here',
});

// Queek-hosted storefront (key optional)
const hostedClient = createQueekClient({
  baseUrl: 'https://api.queek.com.ng/api/v1',
  vendorSlug: 'jonshop',
});

await client.auth.requestOtp({ phone: '+14155552671' });
try {
  await client.auth.verifyOtp({ phone: '+14155552671', otpCode: '1234' });
} catch (error) {
  if (error instanceof QueekSdkError && error.code === 'account_not_found') {
    await client.auth.register({
      firstName: 'Client',
      lastName: 'User',
      email: 'client@example.com',
      phone: '+14155552671',
      otpCode: '1234',
    });
  } else {
    throw error;
  }
}
await client.auth.me();

await client.get('/client/store/info');
await client.get('/client/store/products');
await client.get('/client/store/collections');
await client.get('/client/store/promotions');

await client.auth.logout();
```

## Public Client Methods

- `client.get(path, options?)`
- `client.post(path, body, options?)`
- `client.put(path, body, options?)`
- `client.delete(path, options?)`
- `client.request(config)`

## Automatic Headers and Token Handling

- Sends `X-Client-Key` when configured
- Sends `X-Vendor-Slug` when configured
- Sends `X-Platform: storefront` on every request
- Sends `Authorization: Bearer <token>` when access token exists
- On `401`, refreshes once and retries the original request once
- If refresh fails, clears tokens and throws normalized auth error (`unauthenticated`)
