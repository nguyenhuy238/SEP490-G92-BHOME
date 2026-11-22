import { expect, it, vi } from 'vitest';
import {
  ApiError,
  createApiClient,
  getFieldErrors,
  getUserFriendlyMessage,
  normalizeApiProblem,
} from '../../../../packages/client-core/src/api';

it('normalizes legacy and structured field errors without losing nested paths', () => {
  const problem = normalizeApiProblem(
    {
      errors: { Email: ['Email không hợp lệ.'] },
      fieldErrors: {
        'Employment.EndDate': [
          { code: 'invalid_date_range', message: 'Ngày kết thúc không được trước ngày bắt đầu.' },
        ],
      },
    },
    400,
    'trace',
  );
  expect(getFieldErrors(new ApiError(400, problem))).toEqual({
    email: 'Email không hợp lệ.',
    'employment.endDate': 'Ngày kết thúc không được trước ngày bắt đầu.',
  });
  expect(problem.correlationId).toBe('trace');
});

it.each([null, [], 'Bad Request', { errors: ['invalid'], fieldErrors: { email: 'invalid' } }])(
  'tolerates malformed error envelopes: %j',
  (value) => {
    expect(getFieldErrors(new ApiError(400, normalizeApiProblem(value, 400)))).toEqual({});
  },
);

it('does not display internal messages, raw rejected values or foreign resource details', () => {
  const error = new ApiError(500, {
    detail: 'SQL password=secret',
    message: 'PRIVATE_TEST_DETAIL',
    errors: { Password: ['The value secret is invalid'] },
  });
  expect(getUserFriendlyMessage(error)).not.toMatch(/SQL|secret|PRIVATE_TEST_DETAIL/);
  expect(getFieldErrors(error)).toEqual({});
  expect(
    getFieldErrors(new ApiError(400, { errors: { Password: ['The value secret is invalid'] } }))
      .password,
  ).not.toContain('secret');
  for (const status of [401, 403, 404])
    expect(
      getUserFriendlyMessage(new ApiError(status, { code: 'email_already_used' })),
    ).not.toContain('đã được sử dụng');
});

it('maps known business conflicts and exposes duplicate email at the field', () => {
  const error = new ApiError(409, { code: 'email_already_used' });
  expect(getFieldErrors(error).email).toContain('Email này đã được sử dụng');
  expect(error.message).toBe(getUserFriendlyMessage(error));
});

it('does not retry a mutation after a lost response', async () => {
  const transport = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValueOnce(new TypeError('secret technical detail'));
  try {
    await expect(
      createApiClient('https://api.example.invalid')('/api/v1/payments', { method: 'POST' }),
    ).rejects.toMatchObject({ status: 0 });
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    transport.mockRestore();
  }
});

it('classifies invalid successful JSON as a safe response failure', async () => {
  const transport = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response('<html>PRIVATE_TEST_DETAIL</html>', { status: 200 }));
  try {
    await expect(
      createApiClient('https://api.example.invalid')('/api/v1/staff'),
    ).rejects.toMatchObject({ status: 502, problem: { code: 'invalid_response' } });
    expect(transport).toHaveBeenCalledTimes(1);
  } finally {
    transport.mockRestore();
  }
});

it('preserves approved legacy feedback while refusing arbitrary server details', () => {
  const problem = normalizeApiProblem({ detail: 'Ảnh phải có nền trong suốt.' }, 400);
  expect(getUserFriendlyMessage(new ApiError(400, problem))).toBe('Ảnh phải có nền trong suốt.');
  expect(normalizeApiProblem({ detail: 'Lỗi SQL password=secret' }, 400).message).toBeUndefined();
});
