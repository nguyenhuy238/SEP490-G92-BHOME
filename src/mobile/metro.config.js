const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);

if (
  process.env.EXPO_PUBLIC_STAGING_WEB_PROXY === '1' ||
  process.env.EXPO_PUBLIC_PRODUCT_WEB_PROXY === '1'
) {
  const {
    stagingMobileProxy,
    productMobileProxy,
  } = require('../../scripts/StagingMobileProxy.cjs');
  const proxy =
    process.env.EXPO_PUBLIC_PRODUCT_WEB_PROXY === '1' ? productMobileProxy : stagingMobileProxy;
  const previous = config.server.enhanceMiddleware;
  config.server.enhanceMiddleware = (middleware, server) => {
    const fallback = previous ? previous(middleware, server) : middleware;
    return (req, res, next) => proxy(req, res, () => fallback(req, res, next));
  };
}

module.exports = config;
