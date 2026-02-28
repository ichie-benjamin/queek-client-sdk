import { createQueekClient } from '../src/index.js';

const client = createQueekClient({
  baseUrl: 'https://api.queek.com.ng/api/v1',
  clientKey: 'qck_client_public_key_here',
  mode: 'external_sdk',
});

async function run(): Promise<void> {
  const otp = await client.auth.requestOtp({
    phone: '+14155552671',
    channel: 'sms',
  });

  console.log('requestOtp ->', otp.next_action);

  const login = await client.auth.verifyOtp({
    phone: '+14155552671',
    otpCode: '1234',
  });

  console.log('verifyOtp -> access token', login.access_token.slice(0, 12));

  const me = await client.auth.me();
  console.log('me -> user', me.user.id);

  const storeInfo = await client.get<{ id: string; name: string }>('/client/store/info');
  console.log('store info ->', storeInfo.data.id);

  await client.auth.logout();
  console.log('logout -> done');
}

run().catch((error) => {
  console.error(error);
});
