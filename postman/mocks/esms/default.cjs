// Provider stand-in derived from the documented eSMS Sandbox contract, never a live sender.
const http = require('http');
http
  .createServer((req, res) => {
    if (
      req.method !== 'POST' ||
      req.url.replace(/\/$/, '') !== '/MainService.svc/json/SendMultipleMessage_V4_post_json'
    ) {
      res.writeHead(501);
      res.end();
      return;
    }
    const body = req.body;
    const valid =
      body &&
      body.ApiKey === 'synthetic-api' &&
      body.SecretKey === 'synthetic-secret' &&
      body.Sandbox === '1' &&
      body.SmsType === '2' &&
      body.Brandname === 'Baotrixemay' &&
      body.Content ===
        'Cam on quy khach da su dung dich vu cua chung toi. Chuc quy khach mot ngay tot lanh!' &&
      /^84[35789][0-9]{8}$/.test(body.Phone) &&
      /^[A-F0-9]{40}$/.test(body.RequestId);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify(
        valid ? { CodeResult: '100', SMSID: 'synthetic-simulation-id' } : { CodeResult: '146' },
      ),
    );
  })
  .listen(process.env.PORT || 4510);
