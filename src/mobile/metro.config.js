/* global require, module, __dirname, process */
/* eslint-disable @typescript-eslint/no-require-imports */
const { getDefaultConfig } = require('expo/metro-config');
const config = getDefaultConfig(__dirname);

if (process.env.EXPO_PUBLIC_STAGING_WEB_PROXY === '1') {
  const { stagingMobileProxy } = require('../../scripts/StagingMobileProxy.cjs');
  const previous = config.server.enhanceMiddleware;
  config.server.enhanceMiddleware = (middleware, server) => {
    const fallback = previous ? previous(middleware, server) : middleware;
    return (req, res, next) => stagingMobileProxy(req, res, () => fallback(req, res, next));
  };
}

module.exports = config;
