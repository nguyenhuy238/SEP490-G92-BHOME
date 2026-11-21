// Read-only LAN diagnosis. Trust only the supplied public CA; never disable TLS validation.
const https = require('node:https');
const { readFileSync } = require('node:fs');
const { X509Certificate } = require('node:crypto');
const [input, caPath] = process.argv.slice(2);

async function main() {
  const base = new URL(input);
  if (
    base.protocol !== 'https:' ||
    base.username ||
    base.password ||
    base.pathname !== '/' ||
    base.search ||
    base.hash
  )
    throw new Error('Use an HTTPS API origin and a public CA certificate path.');
  const ca = new X509Certificate(readFileSync(caPath));
  console.log(`API: ${base.origin}; CA SHA-256: ${ca.fingerprint256}`);
  let failed = false;
  for (const [path, expected] of [
    ['/health/live', 200],
    ['/health/ready', 200],
    ['/api/v1/contracts?page=1&pageSize=1', 401],
  ]) {
    await new Promise((resolve) => {
      const request = https.get(
        new URL(path, base),
        { ca: ca.toString(), timeout: 5000 },
        (response) => {
          const certificate = response.socket.getPeerCertificate();
          console.log(
            `${path.split('?')[0]}: HTTP ${response.statusCode}; TLS authorized=${response.socket.authorized}; SAN=${certificate.subjectaltname}; correlationId=${response.headers['x-correlation-id'] ?? '(none)'}`,
          );
          if (response.statusCode !== expected) failed = true;
          response.resume();
          response.on('end', resolve);
          response.on('error', () => {
            failed = true;
            resolve();
          });
        },
      );
      request.on('timeout', () => request.destroy(Object.assign(new Error(), { code: 'TIMEOUT' })));
      request.on('error', (error) => {
        // Node error codes are safe; exception messages may contain configuration details.
        const code = String(error.code ?? 'NETWORK_ERROR').replace(/[^A-Z0-9_]/g, '');
        console.log(`${path.split('?')[0]}: ${code}; no HTTP response confirmed`);
        failed = true;
        resolve();
      });
    });
  }
  for (const [label, options, expected] of [
    [
      'untrusted CA',
      { ca: [] },
      [
        'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'SELF_SIGNED_CERT_IN_CHAIN',
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      ],
    ],
    [
      'wrong TLS server name',
      { ca: ca.toString(), servername: 'synthetic-wrong-host.example.invalid' },
      ['ERR_TLS_CERT_ALTNAME_INVALID'],
    ],
  ]) {
    const code = await new Promise((resolve) => {
      const request = https.get(
        new URL('/health/live', base),
        { ...options, timeout: 5000 },
        (response) => {
          response.resume();
          resolve('UNEXPECTED_SUCCESS');
        },
      );
      request.on('timeout', () => request.destroy(Object.assign(new Error(), { code: 'TIMEOUT' })));
      request.on('error', (error) => resolve(error.code));
    });
    const passed = expected.includes(code);
    console.log(
      `${label}: ${passed ? 'PASS (rejected)' : 'FAIL'}; ${String(code).replace(/[^A-Z0-9_]/g, '')}`,
    );
    if (!passed) failed = true;
  }
  if (failed) process.exitCode = 1;
}
main().catch(() => {
  console.error('Invalid origin, unreadable CA, or diagnosis failed. No TLS check was bypassed.');
  process.exitCode = 1;
});
