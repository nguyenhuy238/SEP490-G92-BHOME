const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);

const staging = process.env.EXPO_PUBLIC_STAGING_WEB_PROXY === '1';
const production = process.env.EXPO_PUBLIC_PRODUCTION_WEB_PROXY === '1';
if (staging !== production) {
  const {
    stagingMobileProxy,
    productionMobileProxy,
  } = require('../../scripts/StagingMobileProxy.cjs');
  const proxy = production ? productionMobileProxy : stagingMobileProxy;
  const previous = config.server.enhanceMiddleware;
  config.server.enhanceMiddleware = (middleware, server) => {
    const fallback = previous ? previous(middleware, server) : middleware;
    return (req, res, next) => proxy(req, res, () => fallback(req, res, next));
  };
}

module.exports = config;
