const { main } = require('./Start-ExpoMobile.cjs');

const STAGING_API_URL = 'https://api-staging.103.146.23.157.sslip.io';

async function startStagingMobile(args = process.argv.slice(2), launch = main) {
  // Keep staging independent of any workstation-specific .env.local or shell settings.
  process.env.EXPO_PUBLIC_API_BASE_URL = STAGING_API_URL;
  delete process.env.EXPO_PUBLIC_DEV_API_BASE_URL;
  delete process.env.EXPO_PUBLIC_DEV_SERVER_ID;
  process.env.EXPO_NO_DOTENV = '1';
  process.env.EXPO_PUBLIC_STAGING_WEB_PROXY = '1';

  console.log(`BHOME Mobile (Web + Expo Go) -> ${STAGING_API_URL}`);
  console.log('Open the Metro Web URL on localhost, or scan the Expo Go QR.');
  // --metro-only bypasses the Windows supervisor that would start a local API.
  return launch(['--metro-only', '--lan', '--clear', ...args]);
}

module.exports = { STAGING_API_URL, startStagingMobile };
if (require.main === module) {
  startStagingMobile()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
