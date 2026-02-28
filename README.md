# Queek Client SDK

Lightweight browser-friendly SDK for `/api/v1/client/auth/*`.

## Install

```bash
npm install @queek/client-sdk
```

## Build

```bash
npm run lint
npm run build
npm test
```

## Usage

```ts
import { createQueekClient } from '@queek/client-sdk';

const client = createQueekClient({
  baseUrl: 'https://api.queek.com.ng',
  clientKey: 'qck_client_public_key_here',
});

await client.auth.requestOtp({ phone: '+14155552671' });
await client.auth.verifyOtp({ phone: '+14155552671', otpCode: '1234' });
await client.auth.me();

await client.get('/api/v1/vendors/config/123');
await client.post('/api/v1/orders', { vendor_id: '...' });
await client.put('/api/v1/orders/123', { note: 'update' });
await client.delete('/api/v1/orders/123');

await client.auth.logout();
```

## Public Client Methods

- `client.get(path, options?)`
- `client.post(path, body, options?)`
- `client.put(path, body, options?)`
- `client.delete(path, options?)`
- `client.request(config)`

## Automatic Headers and Token Handling

- Sends `X-Client-Key` on every request
- Sends `X-Platform: storefront` on every request
- Sends `Authorization: Bearer <token>` when access token exists
- On `401`, refreshes once and retries the original request once
- If refresh fails, clears tokens and throws normalized auth error (`unauthenticated`)
