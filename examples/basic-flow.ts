import { createQueekClient, QueekSdkError } from '../src/index.js';

const client = createQueekClient({
  baseUrl: 'https://client.usequeek.com/v1',
  clientKey: 'pk_live_your_key_here',
  authPathPrefix: '/auth',
  maxRetries: 2,
});

async function run(): Promise<void> {
  const store = await client.get<{ id: string; name: string }>('/store/info');
  console.log('store ->', store.data.name);

  let count = 0;
  for await (const product of client.paginate<{ name: string }>('/store/products', { limit: 50 })) {
    count += 1;
    console.log('product ->', product.name);
  }
  console.log('products ->', count);

  const otp = await client.auth.requestOtp({ phone: '+14155552671', channel: 'sms' });
  console.log('requestOtp ->', otp.next_action);

  const login = await client.auth.verifyOtp({ phone: '+14155552671', otpCode: '123456' });
  console.log('verifyOtp -> signed in as', login.user.id);

  const me = await client.auth.me();
  console.log('me ->', me.user.name);

  await client.auth.logout();
  console.log('logout -> done');
}

run().catch((error: unknown) => {
  if (error instanceof QueekSdkError) {
    console.error(`${error.code} (${error.status})`, error.message, error.requestId ?? '');
  } else {
    console.error(error);
  }
});
