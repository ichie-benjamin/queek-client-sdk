import assert from 'node:assert/strict';
import test from 'node:test';

import { createQueekClient, QueekSdkError } from '../dist/index.js';

const BASE = 'https://api.example.com/v1';

function json(status, payload, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function ok(data, extra = {}) {
  return json(200, { status: 'success', message: 'ok', data, ...extra });
}

function recorder(queue) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    requests.push({ url, init, headers: new Headers(init.headers ?? {}) });
    const next = queue.shift();
    if (!next) {
      throw new Error('No queued response');
    }
    if (next instanceof Error) {
      throw next;
    }
    return typeof next === 'function' ? next(init) : next;
  };
  return { fetch, requests };
}

const tokens = (access, refresh) => ({
  token_type: 'Bearer',
  access_token: access,
  expires_in: 3600,
  expires_at: '2026-02-28T10:00:00Z',
  refresh_token: refresh,
  refresh_expires_in: 86400,
  refresh_expires_at: '2026-03-01T10:00:00Z',
  platform: 'client_web',
  user: { id: 'u1', first_name: 'A', last_name: 'B', name: 'A B', email: null, phone: null, avatar: null, status: 'active' },
});

test('reads the documented error envelope: code, message, request id, doc url, fields', async () => {
  const { fetch } = recorder([
    json(422, {
      status: 'failed',
      message: 'The email field is required.',
      error: {
        code: 'validation_failed',
        message: 'The email field is required.',
        field: 'email',
        errors: { email: ['The email field is required.'] },
        doc_url: 'https://docs.example.com/errors#validation_failed',
        request_id: 'req-12345678',
      },
    }),
  ]);
  const client = createQueekClient({ baseUrl: BASE, clientKey: 'pk_test_x', fetch });

  await assert.rejects(() => client.post('/store/subscribe', {}), (error) => {
    assert.ok(error instanceof QueekSdkError);
    assert.equal(error.code, 'validation_failed');
    assert.equal(error.status, 422);
    assert.equal(error.field, 'email');
    assert.deepEqual(error.errors, { email: ['The email field is required.'] });
    assert.equal(error.requestId, 'req-12345678');
    assert.equal(error.docUrl, 'https://docs.example.com/errors#validation_failed');
    assert.equal(error.retryable, false);
    return true;
  });
});

test('falls back to the request id header and a readable message when the body is not JSON', async () => {
  const { fetch } = recorder([
    new Response('<html>Bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html', 'X-Request-Id': 'hdr-12345678' } }),
  ]);
  const client = createQueekClient({ baseUrl: BASE, fetch });

  await assert.rejects(() => client.get('/store/info'), (error) => {
    assert.equal(error.code, 'unknown_error');
    assert.equal(error.status, 502);
    assert.equal(error.requestId, 'hdr-12345678');
    assert.match(error.message, /502/);
    assert.equal(error.retryable, true);
    return true;
  });
});

test('a legacy error body with a string error key still yields a code', async () => {
  const { fetch } = recorder([json(403, { status: 'failed', error: 'client_not_allowed', message: 'No.' })]);
  const client = createQueekClient({ baseUrl: BASE, fetch });

  await assert.rejects(() => client.get('/x'), (error) => {
    assert.equal(error.code, 'client_not_allowed');
    return true;
  });
});

test('wraps a network failure with its cause and does not leak the key', async () => {
  const cause = new TypeError('fetch failed');
  const { fetch } = recorder([cause]);
  const client = createQueekClient({ baseUrl: BASE, clientKey: 'sk_test_secretvalue', fetch });

  await assert.rejects(() => client.get('/store/info'), (error) => {
    assert.equal(error.code, 'network_error');
    assert.equal(error.status, 0);
    assert.equal(error.cause, cause);
    assert.ok(!error.message.includes('sk_test_secretvalue'));
    return true;
  });
});

test('rejects with code timeout when the API does not answer in time', async () => {
  const hang = (init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const { fetch } = recorder([hang]);
  const client = createQueekClient({ baseUrl: BASE, fetch, timeoutMs: 20 });

  await assert.rejects(() => client.get('/slow'), (error) => {
    assert.equal(error.code, 'timeout');
    assert.match(error.message, /20 ms/);
    return true;
  });
});

test('rejects with code aborted when the caller cancels', async () => {
  const hang = (init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
  });
  const { fetch } = recorder([hang]);
  const client = createQueekClient({ baseUrl: BASE, fetch });
  const controller = new AbortController();

  const pending = client.get('/slow', { signal: controller.signal });
  controller.abort();

  await assert.rejects(() => pending, (error) => error.code === 'aborted');
});

test('retries a GET on 503 and honours Retry-After, then succeeds', async () => {
  const { fetch, requests } = recorder([
    json(503, { status: 'failed', error: { code: 'service_unavailable', message: 'Later.' } }, { 'Retry-After': '0' }),
    ok({ name: 'Shop' }),
  ]);
  const client = createQueekClient({ baseUrl: BASE, fetch, maxRetries: 2 });

  const response = await client.get('/store/info');

  assert.equal(response.data.name, 'Shop');
  assert.equal(requests.length, 2);
});

test('gives up after maxRetries and surfaces retryAfterMs', async () => {
  const body = { status: 'failed', error: { code: 'too_many_requests', message: 'Slow down.' } };
  const { fetch, requests } = recorder([
    json(429, body, { 'Retry-After': '0' }),
    json(429, body, { 'Retry-After': '0' }),
  ]);
  const client = createQueekClient({ baseUrl: BASE, fetch, maxRetries: 1 });

  await assert.rejects(() => client.get('/store/info'), (error) => {
    assert.equal(error.code, 'too_many_requests');
    assert.equal(error.retryAfterMs, 0);
    return true;
  });
  assert.equal(requests.length, 2);
});

test('never retries a write unless it carries an idempotency key', async () => {
  const fail = () => json(503, { status: 'failed', error: { code: 'service_unavailable', message: 'Later.' } }, { 'Retry-After': '0' });
  const bare = recorder([fail(), ok({})]);
  const bareClient = createQueekClient({ baseUrl: BASE, fetch: bare.fetch, maxRetries: 2 });

  await assert.rejects(() => bareClient.post('/store/cart/items', { quantity: 1 }));
  assert.equal(bare.requests.length, 1);

  const keyed = recorder([fail(), ok({})]);
  const keyedClient = createQueekClient({ baseUrl: BASE, fetch: keyed.fetch, maxRetries: 2 });

  await keyedClient.post('/store/cart/items', { quantity: 1 }, { idempotencyKey: 'key-1234567890' });
  assert.equal(keyed.requests.length, 2);
  assert.equal(keyed.requests[1].headers.get('idempotency-key'), 'key-1234567890');
});

test('sends X-Request-Id and encodes query parameters', async () => {
  const { fetch, requests } = recorder([ok([])]);
  const client = createQueekClient({ baseUrl: `${BASE}/`, fetch });

  await client.get('/store/products?locale=fr', {
    requestId: 'trace-12345678',
    query: { keyword: 'jollof & rice', 'ids[]': ['a', 'b'], skip: undefined, none: null, has_video: true },
  });

  assert.equal(
    requests[0].url,
    `${BASE}/store/products?locale=fr&keyword=jollof+%26+rice&ids%5B%5D=a&ids%5B%5D=b&has_video=true`,
  );
  assert.equal(requests[0].headers.get('x-request-id'), 'trace-12345678');
});

test('patch sends PATCH with a JSON body', async () => {
  const { fetch, requests } = recorder([ok({ user: { id: 'u1' } })]);
  const client = createQueekClient({ baseUrl: BASE, fetch });

  await client.patch('/auth/me', { first_name: 'Ada' });

  assert.equal(requests[0].init.method, 'PATCH');
  assert.equal(requests[0].headers.get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(requests[0].init.body), { first_name: 'Ada' });
});

test('a 2xx reply that is not JSON is reported as invalid_response with a fix', async () => {
  const { fetch } = recorder([new Response('<html>Welcome</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })]);
  const client = createQueekClient({ baseUrl: BASE, fetch });

  await assert.rejects(() => client.get('/store/info'), (error) => {
    assert.equal(error.code, 'invalid_response');
    assert.match(error.message, /baseUrl/);
    return true;
  });
});

test('a 204 reply resolves with an empty envelope', async () => {
  const { fetch } = recorder([new Response(null, { status: 204 })]);
  const client = createQueekClient({ baseUrl: BASE, fetch });

  const response = await client.delete('/store/cart/clear');

  assert.equal(response.data, null);
});

test('paginate follows next_cursor until has_more is false', async () => {
  const { fetch, requests } = recorder([
    ok([{ id: 1 }, { id: 2 }], { has_more: true, next_cursor: 'c1' }),
    ok([{ id: 3 }], { has_more: false, next_cursor: null }),
  ]);
  const client = createQueekClient({ baseUrl: BASE, fetch });
  const seen = [];

  for await (const item of client.paginate('/store/products', { limit: 2 })) {
    seen.push(item.id);
  }

  assert.deepEqual(seen, [1, 2, 3]);
  assert.match(requests[0].url, /limit=2/);
  assert.ok(!requests[0].url.includes('starting_after'));
  assert.match(requests[1].url, /starting_after=c1/);
});

test('a 401 from a sign-in route does not trigger a refresh', async () => {
  const { fetch, requests } = recorder([
    ok(tokens('a1', 'r1')),
    json(401, { status: 'failed', error: { code: 'invalid_otp', message: 'Wrong code.' } }),
  ]);
  const client = createQueekClient({ baseUrl: BASE, fetch });

  await client.auth.verifyOtp({ phone: '+14155552671', otpCode: '1111' });
  await assert.rejects(() => client.auth.verifyOtp({ phone: '+14155552671', otpCode: '2222' }), (error) => error.code === 'invalid_otp');

  assert.equal(requests.length, 2);
  assert.equal(client.auth.isAuthenticated(), true);
});

test('onUnauthenticated fires once when the session cannot be renewed', async () => {
  const calls = [];
  const { fetch } = recorder([
    json(401, { status: 'failed', error: { code: 'unauthenticated', message: 'No.' } }),
  ]);
  const client = createQueekClient({
    baseUrl: BASE,
    fetch,
    onUnauthenticated: (context) => calls.push(context),
  });

  await assert.rejects(() => client.get('/store/orders'));

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/store/orders');
});

test('the refresh error keeps its cause and request id', async () => {
  const { fetch } = recorder([
    ok(tokens('a1', 'r1')),
    json(401, { status: 'failed', error: { code: 'unauthenticated', message: 'No.' } }),
    json(401, { status: 'failed', error: { code: 'invalid_refresh_token', message: 'Bad.', request_id: 'req-refresh-1' } }),
  ]);
  const client = createQueekClient({ baseUrl: BASE, fetch });

  await client.auth.verifyOtp({ phone: '+14155552671', otpCode: '1111' });
  await assert.rejects(() => client.get('/store/orders'), (error) => {
    assert.equal(error.code, 'unauthenticated');
    assert.ok(error.cause instanceof QueekSdkError);
    assert.equal(error.cause.code, 'invalid_refresh_token');
    assert.equal(error.requestId, 'req-refresh-1');
    return true;
  });
});

test('email sign-in: new customer gets a verified token and registers', async () => {
  const { fetch, requests } = recorder([
    ok({ next_action: 'verify_otp', email: 'a@example.com', user_exists: false, expires_in: 600, resend_in: 60 }),
    ok({ needs_registration: true, verified_token: 'vt-1' }),
    ok({ ...tokens('a2', 'r2'), is_new_user: true }),
  ]);
  const client = createQueekClient({ baseUrl: BASE, fetch });

  await client.auth.emailRequestOtp({ email: 'a@example.com' });
  const verified = await client.auth.emailVerifyOtp({ email: 'a@example.com', otpCode: '123456' });

  assert.equal(verified.needs_registration, true);
  assert.equal(client.auth.isAuthenticated(), false);

  await client.auth.emailRegisterOtp({ firstName: 'Ada', verifiedToken: 'vt-1' });

  assert.equal(client.auth.getAccessToken(), 'a2');
  assert.equal(requests[0].url, `${BASE}/client/auth/email/request-otp`);
  assert.equal(JSON.parse(requests[2].init.body).verified_token, 'vt-1');
});

test('authPathPrefix points the sign-in helpers at the public gateway routes', async () => {
  const { fetch, requests } = recorder([
    ok({ next_action: 'verify_otp', phone: '+14155552671', user_exists: true, expires_in: 60, resend_in: 60 }),
    ok(tokens('a1', 'r1')),
    ok({ user: { id: 'u1' } }),
    ok(tokens('a2', 'r2')),
    ok({}),
  ]);
  const client = createQueekClient({ baseUrl: BASE, fetch, authPathPrefix: '/auth' });

  await client.auth.requestOtp({ phone: '+14155552671' });
  await client.auth.verifyOtp({ phone: '+14155552671', otpCode: '1234' });
  await client.auth.me();
  await client.auth.refresh();
  await client.auth.logout();

  // The routes listed in the public Storefront API reference.
  assert.deepEqual(
    requests.map((request) => request.url.replace(BASE, '')),
    ['/auth/phone/request-otp', '/auth/phone/verify-otp', '/auth/me', '/auth/token/refresh', '/auth/logout'],
  );
});

test('constructor errors say what to fix', () => {
  assert.throws(() => createQueekClient({ baseUrl: '' }), /baseUrl is required/);
  assert.throws(() => createQueekClient({ baseUrl: BASE, fetch: undefined, mode: 'external_sdk' }), /clientKey is required/);
});
