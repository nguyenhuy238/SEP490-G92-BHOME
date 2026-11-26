import { expect, it, vi } from 'vitest';
import {
  residenceAlert,
  residenceClient,
  type ResidenceTask,
} from '../../../../packages/client-core/src/residence';

const task = {
  trackingActive: true,
  registrationRequired: true,
  registrationExpiresOn: '2026-12-11',
} as ResidenceTask;
it('warns from exactly 15 days before expiry and distinguishes expired dates', () => {
  expect(residenceAlert(task, '2026-11-25')).toBeNull();
  expect(residenceAlert(task, '2026-11-26')).toMatch(/15 ngày/);
  expect(residenceAlert(task, '2026-12-11')).toMatch(/sắp hết hạn/);
  expect(residenceAlert(task, '2026-12-12')).toBe('Tạm trú đã hết hạn');
  expect(residenceAlert({ ...task, registrationRequired: false }, '2026-12-12')).toBeNull();
  expect(residenceAlert({ ...task, trackingActive: false }, '2026-12-12')).toBeNull();
  expect(residenceAlert({ ...task, registrationExpiresOn: null }, '2026-11-26')).toBeNull();
});
it('uploads shared evidence once with explicit member ids in the same contract', async () => {
  const contractId = '00000000-0000-4000-8000-000000000001';
  const a = '00000000-0000-4000-8000-000000000002';
  const b = '00000000-0000-4000-8000-000000000003';
  const request = vi.fn(async () => ({}));
  const client = residenceClient(request as Parameters<typeof residenceClient>[0]);
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  await client.upload({ contractId, residentId: a } as ResidenceTask, bytes, [a, b]);
  expect(request).toHaveBeenCalledTimes(1);
  const [url, options] = request.mock.calls[0] as unknown as [string, RequestInit];
  expect(new URL(url, 'https://example.invalid').searchParams.getAll('residentIds')).toEqual([
    a,
    b,
  ]);
  expect(options.body).toBe(bytes);
});
