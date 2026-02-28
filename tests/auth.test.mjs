import assert from 'node:assert/strict';
import test from 'node:test';

import { createQueekClient, QueekSdkError } from '../dist/index.js';

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}

function tokenData(accessToken, refreshToken) {
  return {
    token_type: 'Bearer',
    access_token: accessToken,
    expires_in: 3600,
    expires_at: '2026-02-28T10:00:00Z',
    refresh_token: refreshToken,
    refresh_expires_in: 86400,
    refresh_expires_at: '2026-03-01T10:00:00Z',
    platform: 'client_web',
    user: {
      id: 'user-1',
      first_name: 'A',
      last_name: 'B',
      name: 'A B',
      email: 'a@example.com',
      phone: '+14155552671',
      avatar: null,
      status: 'active',
    },
  };
}

function makeFetch(queue, requests) {
  return async (url, init = {}) => {
    requests.push({
      url,
      init,
      headers: new Headers(init.headers ?? {}),
    });

    const next = queue.shift();

    if (!next) {
      throw new Error('No queued response for request');
    }

    return next;
  };
}

test('attaches mandatory headers on auth requests', async () => {
  const requests = [];
  const fetch = makeFetch([
    jsonResponse(200, {
      status: 'success',
      message: 'ok',
      data: {
        next_action: 'verify_otp',
        phone: '+14155552671',
        user_exists: true,
        expires_in: 120,
        resend_in: 120,
      },
    }),
  ], requests);

  const client = createQueekClient({
    baseUrl: 'https://api.example.com/api/v1',
    clientKey: 'public-key-abc',
    vendorSlug: 'vendor-one',
    fetch,
  });

  await client.auth.requestOtp({ phone: '+14155552671' });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.get('x-client-key'), 'public-key-abc');
  assert.equal(requests[0].headers.get('x-vendor-slug'), 'vendor-one');
  assert.equal(requests[0].headers.get('x-platform'), 'storefront');
  assert.equal(requests[0].headers.get('accept'), 'application/json');
});

test('supports hosted storefront mode without client key', async () => {
  const requests = [];
  const fetch = makeFetch([
    jsonResponse(200, {
      status: 'success',
      message: 'ok',
      data: {
        next_action: 'verify_otp',
        phone: '+14155552671',
        user_exists: true,
        expires_in: 120,
        resend_in: 120,
      },
    }),
  ], requests);

  const client = createQueekClient({
    baseUrl: 'https://api.example.com/api/v1',
    vendorSlug: 'vendor-hosted',
    mode: 'hosted_storefront',
    fetch,
  });

  await client.auth.requestOtp({ phone: '+14155552671' });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.get('x-client-key'), null);
  assert.equal(requests[0].headers.get('x-vendor-slug'), 'vendor-hosted');
  assert.equal(requests[0].headers.get('x-platform'), 'storefront');
});

test('requires client key in external sdk mode', async () => {
  assert.throws(
    () => createQueekClient({
      baseUrl: 'https://api.example.com/api/v1',
      mode: 'external_sdk',
    }),
    /clientKey is required when mode is external_sdk/,
  );
});

test('exposes client get/post/put/delete and sends auth header when token exists', async () => {
  const requests = [];
  const fetch = makeFetch([
    jsonResponse(200, {
      status: 'success',
      message: 'verified',
      data: tokenData('access-1', 'refresh-1'),
    }),
    jsonResponse(200, {
      status: 'success',
      message: 'ok',
      data: { method: 'get' },
    }),
    jsonResponse(200, {
      status: 'success',
      message: 'ok',
      data: { method: 'post' },
    }),
    jsonResponse(200, {
      status: 'success',
      message: 'ok',
      data: { method: 'put' },
    }),
    jsonResponse(200, {
      status: 'success',
      message: 'ok',
      data: { method: 'delete' },
    }),
  ], requests);

  const client = createQueekClient({
    baseUrl: 'https://api.example.com/api/v1',
    clientKey: 'public-key-abc',
    fetch,
  });

  await client.auth.verifyOtp({
    phone: '+14155552671',
    otpCode: '1234',
  });

  await client.get('/vendors');
  await client.post('/orders', { a: 1 });
  await client.put('/orders/1', { b: 2 });
  await client.delete('/orders/1');

  assert.equal(requests.length, 5);

  for (let i = 1; i < requests.length; i += 1) {
    assert.equal(requests[i].headers.get('authorization'), 'Bearer access-1');
    assert.equal(requests[i].headers.get('x-client-key'), 'public-key-abc');
    assert.equal(requests[i].headers.get('x-platform'), 'storefront');
  }

  assert.equal(requests[1].init.method, 'GET');
  assert.equal(requests[2].init.method, 'POST');
  assert.equal(requests[3].init.method, 'PUT');
  assert.equal(requests[4].init.method, 'DELETE');
});

test('auto-refreshes once on 401 and retries original request once', async () => {
  const requests = [];
  const fetch = makeFetch([
    jsonResponse(200, {
      status: 'success',
      message: 'verified',
      data: tokenData('old-access-token', 'refresh-token-1'),
    }),
    jsonResponse(401, {
      status: 'failed',
      error_code: 'unauthenticated',
      message: 'Unauthenticated',
    }),
    jsonResponse(200, {
      status: 'success',
      message: 'refreshed',
      data: tokenData('new-access-token', 'refresh-token-2'),
    }),
    jsonResponse(200, {
      status: 'success',
      message: 'ok',
      data: {
        value: 1,
      },
    }),
  ], requests);

  const client = createQueekClient({
    baseUrl: 'https://api.example.com/api/v1',
    clientKey: 'public-key-abc',
    fetch,
  });

  await client.auth.verifyOtp({
    phone: '+14155552671',
    otpCode: '1234',
  });

  const response = await client.get('/vendors');

  assert.equal(response.data.value, 1);
  assert.equal(requests.length, 4);

  assert.equal(requests[2].url, 'https://api.example.com/api/v1/client/auth/token/refresh');
  assert.equal(requests[3].headers.get('authorization'), 'Bearer new-access-token');
});

test('clears session and returns normalized auth error when refresh fails', async () => {
  const requests = [];
  const fetch = makeFetch([
    jsonResponse(200, {
      status: 'success',
      message: 'verified',
      data: tokenData('old-access-token', 'refresh-token-1'),
    }),
    jsonResponse(401, {
      status: 'failed',
      error_code: 'unauthenticated',
      message: 'Unauthenticated',
    }),
    jsonResponse(401, {
      status: 'failed',
      error_code: 'invalid_refresh_token',
      message: 'Refresh token is invalid.',
    }),
  ], requests);

  const client = createQueekClient({
    baseUrl: 'https://api.example.com/api/v1',
    clientKey: 'public-key-abc',
    fetch,
  });

  await client.auth.verifyOtp({
    phone: '+14155552671',
    otpCode: '1234',
  });

  await assert.rejects(
    () => client.get('/vendors'),
    (error) => {
      assert.ok(error instanceof QueekSdkError);
      assert.equal(error.code, 'unauthenticated');
      assert.equal(error.status, 401);
      return true;
    },
  );

  assert.equal(client.auth.isAuthenticated(), false);
  assert.equal(client.auth.getAccessToken(), null);
});

test('normalizes backend errors into QueekSdkError', async () => {
  const requests = [];
  const fetch = makeFetch([
    jsonResponse(403, {
      status: 'failed',
      error_code: 'client_not_allowed',
      message: 'Client domain is not allowed.',
    }),
  ], requests);

  const client = createQueekClient({
    baseUrl: 'https://api.example.com/api/v1',
    clientKey: 'public-key-abc',
    fetch,
  });

  await assert.rejects(
    () => client.auth.requestOtp({ phone: '+14155552671' }),
    (error) => {
      assert.ok(error instanceof QueekSdkError);
      assert.equal(error.code, 'client_not_allowed');
      assert.equal(error.status, 403);
      return true;
    },
  );
});
