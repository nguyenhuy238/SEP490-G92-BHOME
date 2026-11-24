const { getDefaultConfig } = require('expo/metro-config');
const { stagingProxy } = require('../../scripts/mobileStagingProxy.cjs');

const config = getDefaultConfig(__dirname);
if (process.env.EXPO_PUBLIC_STAGING_WEB_PROXY === '1') {
  const previous = config.server.enhanceMiddleware;
  config.server.enhanceMiddleware = (middleware, server) => {
    const next = previous ? previous(middleware, server) : middleware;
    return (req, res, done) => stagingProxy(req, res, () => next(req, res, done));
  };
}

module.exports = config;
