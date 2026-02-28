import { createQueekClient } from '../src/index.js';

const client = createQueekClient({
  baseUrl: 'https://api.queek.com.ng/api/v1',
  clientKey: 'qck_client_public_key_here',
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

  const storefrontHealth = await client.get<{ ok: boolean }>('/storefront/health');
  console.log('storefront health ->', storefrontHealth.data.ok);

  await client.auth.logout();
  console.log('logout -> done');
}

run().catch((error) => {
  console.error(error);
});
