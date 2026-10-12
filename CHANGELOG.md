# Changelog

## 0.4.0 - 2026-10-12

The package moves to the Queek scope: install `@usequeek/client-sdk`. It was `@queekai/client-sdk` up to 0.3.1, which is deprecated and will not receive updates.

Source brought back in line with the published 0.3.1 and extended. All changes are additive.

- Email one-time-password sign-in: `emailRequestOtp`, `emailVerifyOtp`, `emailRegisterOtp`.
- `onUnauthenticated` callback, and a `platform` option for the sign-in body.
- `patch` and `paginate` on the client; `PATCH` accepted by `request`.
- Request options: `query`, `signal`, `timeoutMs`, `maxRetries`, `idempotencyKey`, `requestId`.
- Client options: `timeoutMs` (default 30000), `maxRetries` (default 0), `authPathPrefix`.
- `QueekSdkError` now carries `requestId`, `docUrl`, `field`, `errors`, `retryAfterMs`, `retryable` and `cause`. It reads the `error` object of the current error envelope as well as the older top-level keys.
- New error codes `network_error`, `timeout`, `aborted` and `invalid_response`. A non-JSON success reply is now an `invalid_response` error instead of a `null` envelope.
- A `401` from a sign-in route no longer triggers a session refresh.

## 0.1.0 to 0.3.1

Published to npm. Their source was not committed to this repository before 0.3.1.
