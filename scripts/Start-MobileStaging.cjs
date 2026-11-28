const { main } = require('./Start-ExpoMobile.cjs');
const { STAGING_ORIGIN } = require('./mobileStagingProxy.cjs');

// Explicitly select Staging and ignore stale local Expo settings. No local API,
// certificate, Docker, database, or credential setup is needed.
process.env.EXPO_NO_DOTENV = '1';
process.env.EXPO_PUBLIC_API_BASE_URL = STAGING_ORIGIN;
process.env.EXPO_PUBLIC_DEV_API_BASE_URL = '';
process.env.EXPO_PUBLIC_DEV_SERVER_ID = 'bhome-staging';
process.env.EXPO_PUBLIC_STAGING_WEB_PROXY = '1';
process.env.EXPO_PUBLIC_PRODUCTION_WEB_PROXY = '0';
delete process.env.EXPO_PACKAGER_PROXY_URL;

console.log(`BHOME Mobile Staging: ${STAGING_ORIGIN}`);
main(['--metro-only', '--lan', ...process.argv.slice(2)])
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
