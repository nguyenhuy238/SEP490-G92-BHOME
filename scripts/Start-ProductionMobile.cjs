const { main } = require('./Start-ExpoMobile.cjs');

const PRODUCTION_API_URL = 'https://api.103.146.23.157.sslip.io';

async function startProductionMobile(args = process.argv.slice(2), launch = main) {
  // Pin the production API for this bundle and ignore workstation .env/shell settings.
  process.env.EXPO_PUBLIC_API_BASE_URL = PRODUCTION_API_URL;
  delete process.env.EXPO_PUBLIC_DEV_API_BASE_URL;
  delete process.env.EXPO_PUBLIC_DEV_SERVER_ID;
  process.env.EXPO_NO_DOTENV = '1';
  delete process.env.EXPO_PUBLIC_STAGING_WEB_PROXY;
  delete process.env.EXPO_PUBLIC_DEMO_CLOCK_ENABLED;

  console.log(`BHOME Mobile (Web + Expo Go) -> Production API ${PRODUCTION_API_URL}`);
  console.log('Open the Metro Web URL on localhost, or scan the Expo Go QR.');
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
