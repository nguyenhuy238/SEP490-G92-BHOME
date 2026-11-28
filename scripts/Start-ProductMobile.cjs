const { main } = require('./Start-ExpoMobile.cjs');

const PRODUCT_API_URL = 'https://api.103.146.23.157.sslip.io';

async function startProductMobile(args = process.argv.slice(2), launch = main) {
  // Keep production independent of workstation dotenv and staging/demo settings.
  process.env.EXPO_PUBLIC_API_BASE_URL = PRODUCT_API_URL;
  delete process.env.EXPO_PUBLIC_DEV_API_BASE_URL;
  delete process.env.EXPO_PUBLIC_DEV_SERVER_ID;
  delete process.env.EXPO_PUBLIC_STAGING_WEB_PROXY;
  process.env.EXPO_NO_DOTENV = '1';
  process.env.EXPO_PUBLIC_PRODUCT_WEB_PROXY = '1';
  process.env.EXPO_PUBLIC_DEMO_CLOCK_ENABLED = 'false';
  process.env.EXPO_PUBLIC_SMS_DEMO_ENABLED = 'false';

  console.log(`BHOME Mobile (Production, Web + Expo Go) -> ${PRODUCT_API_URL}`);
  console.log('Open the Metro Web URL on localhost, or scan the Expo Go QR.');
  return launch(['--metro-only', '--lan', '--clear', ...args]);
}

module.exports = { PRODUCT_API_URL, startProductMobile };
if (require.main === module) {
  startProductMobile()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
