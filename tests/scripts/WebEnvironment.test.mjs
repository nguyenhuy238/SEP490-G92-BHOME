// Real Vite networking against two disposable loopback HTTPS APIs. No application DB/provider is used.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer as createHttpsServer, get as httpsGet } from 'node:https';
import { get as httpGet } from 'node:http';
import { fileURLToPath, URL } from 'node:url';
import process from 'node:process';
import { log } from 'node:console';
import { createServer as createViteServer } from '../../src/owner-web/node_modules/vite/dist/node/index.js';

const cert = readFileSync(new URL('../../.tools/team-tls/localhost.pem', import.meta.url));
const key = readFileSync(new URL('../../.tools/team-tls/localhost.key', import.meta.url));
const root = fileURLToPath(new URL('../../src/owner-web', import.meta.url));
const original = { ...process.env };
function request(url) {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https:') ? httpsGet : httpGet;
    const req = get(url, { ca: cert, rejectUnauthorized: true }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
      });
      response.on('end', () =>
        resolve({ status: response.statusCode, headers: response.headers, body }),
      );
    });
    req.setTimeout(10000, () => req.destroy(new Error('Local Vite probe timed out.')));
    req.on('error', reject);
  });
}
try {
  delete process.env.VITE_DEPLOYMENT_ORIGIN;
  for (const [developer, https] of [
    ['DeveloperA', false],
    ['DeveloperB', true],
  ]) {
    const upstream = createHttpsServer({ cert, key }, (req, res) => {
      if (req.url === '/open/sign-contract?probe=synthetic') {
        res.writeHead(302, { Location: 'bhome://sign-contract?probe=synthetic' });
        res.end();
        return;
      }
      assert.equal(req.url, '/api/environment-probe');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ developer }));
    });
    await new Promise((resolve) => upstream.listen(0, 'localhost', resolve));
    process.env.VITE_API_MODE = 'api';
    process.env.VITE_API_BASE_URL = `https://localhost:${upstream.address().port}`;
    process.env.BHOME_WEB_HTTPS = String(https);
    let vite;
    try {
      vite = await createViteServer({
        root,
        configFile: `${root}/vite.config.ts`,
        logLevel: 'error',
        server: { port: 0, host: 'localhost', watch: null },
      });
      await vite.listen();
      const origin = `${https ? 'https' : 'http'}://localhost:${vite.httpServer.address().port}`;
      const api = await request(`${origin}/api/environment-probe`);
      assert.equal(api.status, 200);
      assert.equal(JSON.parse(api.body).developer, developer);
      const signing = await request(`${origin}/open/sign-contract?probe=synthetic`);
      assert.equal(signing.status, 302);
      assert.equal(signing.headers.location, 'bhome://sign-contract?probe=synthetic');
      for (const route of [
        '/accept-invitation',
        '/reset-password',
        '/confirm-email',
        '/contract-signing',
      ]) {
        const page = await request(origin + route);
        assert.equal(page.status, 200);
        assert.match(page.body, /id="root"/);
      }
      log(
        `PASS: ${developer}: ${https ? 'HTTPS signing portal' : 'HTTP portal'}, TLS-verified API/signing proxies, four SPA routes.`,
      );
    } finally {
      if (vite) await vite.close();
      await new Promise((resolve) => upstream.close(resolve));
    }
  }
} finally {
  for (const key of Object.keys(process.env)) if (!(key in original)) delete process.env[key];
  Object.assign(process.env, original);
}
