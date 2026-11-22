import { expect, it, vi } from 'vitest';
import { getFieldErrors } from '../../../../packages/client-core/src/api';
import { MobileApiError, mobileResponse, errorMessage } from '../lib/api';
import { incidentError } from '../services/incidents';

it('preserves structured and legacy server errors for inline Mobile feedback', async () => {
  const transport = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        code: 'validation_error',
        errors: { FullName: ['Vui lòng nhập họ và tên.'] },
        fieldErrors: {
          Email: [{ code: 'invalid_email_format', message: 'Email không đúng định dạng.' }],
        },
        traceId: 'trace',
      }),
      {
        status: 400,
        headers: { 'Content-Type': 'application/problem+json', 'X-Correlation-ID': 'trace' },
      },
    ),
  );
  const error = await mobileResponse(
    'https://api.example.invalid',
    '/api/v1/staff',
    { method: 'POST' },
    transport,
    (response) => response.json(),
  ).catch((cause: unknown) => cause);
  expect(error).toBeInstanceOf(MobileApiError);
  expect(getFieldErrors(error)).toEqual({
    fullName: 'Vui lòng nhập họ và tên.',
    email: 'Email không đúng định dạng.',
  });
  expect(errorMessage(error)).toContain('Thông tin nhập chưa hợp lệ');
  expect((error as MobileApiError).correlationId).toBe('trace');
});

it.each([null, [], 'Bad Request', { message: 'SQL password=secret' }])(
  'handles malformed or unsafe problem bodies: %j',
  async (body) => {
    const transport = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(body), { status: 500 }));
    const error = await mobileResponse(
      'https://api.example.invalid',
      '/api/v1/invoices',
      {},
      transport,
      (response) => response.json(),
    ).catch((cause: unknown) => cause);
    expect(errorMessage(error)).not.toMatch(/SQL|password|secret|Bad Request/);
    expect(getFieldErrors(error)).toEqual({});
  },
);

it('never retries a financial mutation on transport failure', async () => {
  const transport = vi.fn().mockRejectedValue(new TypeError('network'));
  await expect(
    mobileResponse(
      'https://api.example.invalid',
      '/api/v1/payments',
      { method: 'POST' },
      transport,
      (response) => response.json(),
    ),
  ).rejects.toMatchObject({ code: 'network_unavailable' });
  expect(transport).toHaveBeenCalledTimes(1);
});

it('shows an incident refusal once and conceals unexpected technical details', () => {
  const message = incidentError(new MobileApiError(409, 'incident_closed'));
  expect(message.match(/Sự cố đã đóng/g)).toHaveLength(1);
  expect(incidentError(new Error('PRIVATE_TEST_DETAIL'))).not.toContain('PRIVATE_TEST_DETAIL');
});
