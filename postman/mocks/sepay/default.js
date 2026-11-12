/* global require, process, URL */
// Synthetic contract fixture derived from the official SePay API v2 transaction documentation.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require('http');

http
  .createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost');
    response.setHeader('Content-Type', 'application/json');
    if (request.method !== 'GET' || url.pathname !== '/v2/transactions') {
      response.writeHead(501);
      response.end(JSON.stringify({ error: 'Outside the simulated SePay contract' }));
      return;
    }
    if (request.headers.authorization !== 'Bearer synthetic-only-token') {
      response.writeHead(401);
      response.end(JSON.stringify({ status: 'error' }));
      return;
    }
    response.end(
      JSON.stringify({
        status: 'success',
        data: [
          {
            id: 'b206209a-e3a8-432a-a3b1-57956a266921',
            transaction_date: new Date(Date.now() - 60000).toISOString(),
            account_number: '0000001234',
            va: null,
            amount_in: 100000,
            amount_out: 0,
            accumulated: 100000,
            transaction_content: 'BH12345678',
            reference_number: 'SYN-API-1',
            code: 'BH12345678',
            bank_brand_name: 'ACB',
            transfer_type: 'in',
          },
        ],
        meta: {
          pagination: { current_page: Number(url.searchParams.get('page') ?? 1), has_more: false },
        },
      }),
    );
  })
  .listen(process.env.PORT || 4500);
