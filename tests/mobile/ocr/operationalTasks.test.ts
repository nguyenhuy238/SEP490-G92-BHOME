import { expect, it, vi } from 'vitest';
import { MobileApi } from '../../../src/mobile/src/lib/api';
import {
  availableTaskActions,
  operationalTasks,
  type OperationalTask,
} from '../../../src/mobile/src/services/operationalTasks';

const id = '00000000-0000-0000-0000-000000000001';
const key = '00000000-0000-0000-0000-000000000002';
const task = {
  id,
  kind: 'AdHoc',
  status: 'InProgress',
  currentResponsibleStaffUserId: 'staff',
} as OperationalTask;
const setup = (transport: typeof fetch) =>
  operationalTasks(
    new MobileApi(
      'https://api.example.invalid',
      () => 'synthetic-token',
      async () => undefined,
      vi.fn(),
      transport,
    ),
  );

it('keeps Owner verification and Staff execution separate, including reassignment and meter tasks', () => {
  expect(availableTaskActions(task, 'Staff', 'staff')).toEqual(['progress', 'blockers', 'submit']);
  expect(availableTaskActions(task, 'Staff', 'another-staff')).toEqual([]);
  expect(availableTaskActions(task, 'Tenant', 'staff')).toEqual([]);
  expect(
    availableTaskActions({ ...task, status: 'PendingVerification' }, 'Owner', 'owner'),
  ).toContain('verify');
  expect(
    availableTaskActions({ ...task, status: 'PendingVerification' }, 'Staff', 'staff'),
  ).toEqual([]);
  expect(availableTaskActions({ ...task, status: 'Completed' }, 'Owner', 'owner')).toEqual([]);
  expect(availableTaskActions({ ...task, kind: 'MeterReading' }, 'Staff', 'staff')).toEqual([]);
});
it('sends confirmed API fields, version, bearer auth and idempotency key for a mutation', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(task)));
  await setup(fetcher).act(id, 'submit', 7, 'Đã kiểm tra', [key], key);
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe(`https://api.example.invalid/api/v1/operational-tasks/${id}/submit`);
  expect(init?.method).toBe('POST');
  expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(key);
  expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer synthetic-token');
  expect(JSON.parse(init?.body as string)).toEqual({
    version: 7,
    note: 'Đã kiểm tra',
    evidenceIds: [key],
  });
  expect(init?.credentials).toBe('omit');
});
it('uploads image bytes privately with an idempotency key instead of posting a public URL', async () => {
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response(JSON.stringify({ id: key })));
  const bytes = new Uint8Array([255, 216, 255]);
  await setup(fetcher).upload(id, bytes, key);
  const [url, init] = fetcher.mock.calls[0]!;
  expect(url).toBe(`https://api.example.invalid/api/v1/operational-tasks/${id}/evidence`);
  expect(init?.method).toBe('PUT');
  expect(init?.body).toBe(bytes);
  expect(new Headers(init?.headers).get('Content-Type')).toBe('image/jpeg');
  expect(new Headers(init?.headers).get('Idempotency-Key')).toBe(key);
});
it.each([403, 404, 409])(
  'propagates server rejection %s without returning sample data',
  async (status) => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ code: 'stale_version' }), { status }));
    await expect(setup(fetcher).act(id, 'start', 1, '', [], key)).rejects.toMatchObject({ status });
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);
it('rejects malformed deep-link identifiers before any authenticated request', async () => {
  const fetcher = vi.fn<typeof fetch>();
  expect(() => setup(fetcher).get('../other')).toThrow();
  expect(() => setup(fetcher).read('bad-id')).toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});
it('marks a notification read using its confirmed endpoint', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));
  await setup(fetcher).read(id);
  expect(fetcher.mock.calls[0]?.[0]).toBe(
    `https://api.example.invalid/api/v1/operational-tasks/notifications/${id}/read`,
  );
  expect(fetcher.mock.calls[0]?.[1]?.method).toBe('POST');
});
