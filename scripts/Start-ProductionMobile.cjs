const { main } = require('./Start-ExpoMobile.cjs');

const PRODUCTION_API_URL = 'https://api.103.146.23.157.sslip.io';

async function startProductionMobile(args = process.argv.slice(2), launch = main) {
  // Explicit opt-in to live data. Use only the fixed Production relay on loopback Web.
  process.env.EXPO_NO_DOTENV = '1';
  process.env.EXPO_PUBLIC_API_BASE_URL = PRODUCTION_API_URL;
  delete process.env.EXPO_PUBLIC_DEV_API_BASE_URL;
  process.env.EXPO_PUBLIC_DEV_SERVER_ID = 'bhome-production';
  process.env.EXPO_PUBLIC_STAGING_WEB_PROXY = '0';
  process.env.EXPO_PUBLIC_PRODUCTION_WEB_PROXY = '1';
  process.env.EXPO_PUBLIC_DEMO_CLOCK_ENABLED = 'false';
  process.env.EXPO_PUBLIC_SMS_DEMO_ENABLED = 'false';
  delete process.env.EXPO_PACKAGER_PROXY_URL;

  console.warn(`BHOME Mobile PRODUCTION (LIVE DATA) -> ${PRODUCTION_API_URL}`);
  console.log('Scan the Expo Go QR or open Metro Web on localhost. Authorized accounts only.');
  return launch(['--metro-only', '--lan', '--clear', ...args]);
}

module.exports = { PRODUCTION_API_URL, startProductionMobile };
if (require.main === module) {
  startProductionMobile()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
