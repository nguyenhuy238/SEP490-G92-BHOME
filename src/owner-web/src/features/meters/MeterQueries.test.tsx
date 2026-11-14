import { expect, it, vi } from 'vitest';
import { meterClient } from '../../../../../packages/client-core/src/meter';
import { invoiceClient } from '../../../../../packages/client-core/src/invoices';

it('uses server filters and pagination for meter history without submitting confirmation', async () => {
  const request = vi.fn().mockResolvedValue([]);
  const signal = new AbortController().signal;
  await meterClient(request).tasks(signal, {
    locationId: 'location',
    roomId: 'room',
    status: '2',
    dueDate: '2026-11-09',
    page: 3,
  });
  const [path, init] = request.mock.calls[0];
  expect(new URL(path, 'https://example.invalid').searchParams.get('page')).toBe('3');
  expect(path).toContain('roomId=room&status=2&dueDate=2026-11-09');
  expect(init).toEqual({ signal });
});
it('applies the Room invoice filter before pagination and keeps the unfiltered client compatible', async () => {
  const request = vi.fn().mockResolvedValue({ items: [] });
  const api = invoiceClient(request);
  await api.list(2, undefined, 'room');
  expect(request.mock.calls[0][0]).toBe('/api/v1/invoices?page=2&pageSize=20&roomId=room');
  await api.list();
  expect(request.mock.calls[1][0]).toBe('/api/v1/invoices?page=1&pageSize=20');
});
it('serializes invoice status, Location and month without removing Room scope', async () => {
  const request = vi.fn().mockResolvedValue({ items: [] });
  await invoiceClient(request).list(3, undefined, 'room', {
    locationId: 'location',
    billingPeriod: '2026-11-01',
    status: 'Draft',
  });
  const query = new URL(request.mock.calls[0][0], 'https://example.invalid').searchParams;
  expect(Object.fromEntries(query)).toEqual({
    page: '3',
    pageSize: '20',
    roomId: 'room',
    locationId: 'location',
    billingPeriod: '2026-11-01',
    status: 'Draft',
  });
});
