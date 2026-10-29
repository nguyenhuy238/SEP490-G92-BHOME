// Local launcher readiness only. Verify the private CA and hostname without installing trust globally.
const { readFileSync } = require('node:fs');
const { X509Certificate } = require('node:crypto');
const https = require('node:https');
const [address, certificate] = process.argv.slice(2);
try {
  const request = https.get(
    `https://${address}:7240/health/ready`,
    { ca: new X509Certificate(readFileSync(certificate)).toString(), timeout: 2000 },
    (response) => {
      response.resume();
      process.exitCode = response.statusCode === 200 ? 0 : 1;
    },
  );
  request.on('timeout', () => request.destroy());
  request.on('error', () => {
    process.exitCode = 1;
  });
} catch {
  process.exitCode = 1;
}
