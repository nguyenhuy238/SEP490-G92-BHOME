// Local launcher readiness only. Verify the private CA and hostname without installing trust globally.
const { readFileSync } = require('node:fs');
const { X509Certificate } = require('node:crypto');
const https = require('node:https');
function probeMobileApi({ address, ca, expectedAddress, timeoutMs = 2500 }, get = https.get) {
  return new Promise((resolve) => {
    let settled = false;
    let request;
    const finish = (healthy) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(healthy);
    };
    // Cover DNS resolution as well as TCP/TLS/body, including an unresponsive host.
    const timer = setTimeout(() => {
      finish(false);
      request?.destroy();
    }, timeoutMs);
    try {
      const url = new URL(`https://${address}:7240/health/ready`);
      if (url.hostname !== address || url.username || url.password) return finish(false);
      request = get(url, { ca, rejectUnauthorized: true, family: 4 }, (response) => {
        response.on('error', () => finish(false));
        const actualAddress = response.socket.remoteAddress?.replace(/^::ffff:/, '');
        if (response.statusCode !== 200 || (expectedAddress && actualAddress !== expectedAddress)) {
          response.resume();
          return finish(false);
        }
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
          if (body.length > 64) {
            finish(false);
            request?.destroy();
          }
        });
        response.on('end', () => finish(body.trim() === 'Healthy'));
      });
      request.on('error', () => finish(false));
    } catch {
      finish(false);
    }
  });
}

module.exports = { probeMobileApi };
if (require.main === module) {
  const [address, certificate, expectedAddress, timeout = '2500'] = process.argv.slice(2);
  try {
    const timeoutMs = Number(timeout);
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000)
      throw new Error('Invalid probe timeout.');
    const ca = new X509Certificate(readFileSync(certificate)).toString();
    probeMobileApi({ address, ca, expectedAddress, timeoutMs }).then((healthy) => {
      // This one-shot probe must also stop pending OS DNS work after the deadline.
      process.exit(healthy ? 0 : 1);
    });
  } catch {
    process.exitCode = 1;
  }
}
