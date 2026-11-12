import { expect, it, vi } from 'vitest';
import type { MobileApi } from '../../../src/mobile/src/lib/api';
import {
  loadTenantReadings,
  loadTenantSettlements,
} from '../../../src/mobile/src/features/workspace/tenantFinancialLoads';
const signal = new AbortController().signal;
const api = (value: unknown) =>
  ({ request: vi.fn().mockResolvedValue(value) }) as unknown as MobileApi;
const charge = {
  id: 'charge',
  description: 'Synthetic approved damage',
  amount: '999999999999999999',
};
const settlement = {
  items: [
    {
      contractId: 'contract',
      roomNumber: 'SYN-101',
      receivables: [{ charge, allocated: '0', outstanding: charge.amount, status: 'Unpaid' }],
      offsets: [],
    },
  ],
  total: 1,
};
const reading = {
  id: 'reading',
  roomId: 'room',
  roomNumber: 'SYN-101',
  locationName: 'Synthetic',
  meterCode: 'SYN-POWER',
  utilityType: 'Electricity',
  purpose: 'Periodic',
  readingDate: '2026-11-01',
  billingPeriod: '2026-11-01',
  previousValue: '100',
  confirmedValue: '125.5000',
  consumption: '25.5000',
  confirmedAt: '2026-11-01T03:00:00Z',
  status: 'Confirmed',
};
it('keeps exact VND and confirmed quantities without inferring payment or OCR confirmation', async () => {
  const result = await loadTenantSettlements(api(settlement), '/settlements', signal);
  expect(result.items[0].receivables[0].charge.amount).toBe('999999999999999999');
  expect(result.items[0].receivables[0].status).toBe('Unpaid');
  const rows = await loadTenantReadings(
    api({ items: [reading], page: 1, pageSize: 20, totalCount: 1 }),
    '/readings',
    signal,
  );
  expect(rows.items[0].confirmedValue).toBe('125.5000');
});
it('rejects malformed money and unrelated page rows instead of displaying an empty or paid balance', async () => {
  for (const value of [
    { items: [{ id: 'invoice' }], total: 1 },
    { ...settlement, total: -1 },
    {
      items: [
        {
          ...settlement.items[0],
          receivables: [{ ...settlement.items[0].receivables[0], allocated: '1e6' }],
        },
      ],
      total: 1,
    },
    { items: [{ ...settlement.items[0], offsets: null }], total: 1 },
  ]) {
    await expect(loadTenantSettlements(api(value), '/settlements', signal)).rejects.toThrow(
      'Dữ liệu tài chính',
    );
  }
});
it('accepts exact decimal policy rates and string day counts emitted by FixedChargeSource', async () => {
  const value = {
    ...settlement,
    items: [
      {
        ...settlement.items[0],
        receivables: [
          {
            ...settlement.items[0].receivables[0],
            charge: {
              ...charge,
              amount: charge.amount + '.0000',
              fixedCharge: {
                rate: '12345.1234',
                partialMonth: 1,
                occupiedDays: '15',
                periodDays: '30',
              },
            },
          },
        ],
      },
    ],
  };
  const result = await loadTenantSettlements(api(value), '/settlements', signal);
  expect(result.items[0].receivables[0].charge.fixedCharge?.rate).toBe('12345.1234');
  expect(result.items[0].receivables[0].charge.fixedCharge?.occupiedDays).toBe('15');
  expect(result.items[0].receivables[0].charge.amount).toBe('999999999999999999.0000');
  value.items[0]!.receivables[0]!.charge.amount = '1.25';
  await expect(loadTenantSettlements(api(value), '/settlements', signal)).rejects.toThrow(
    'Dữ liệu tài chính',
  );
});
it('rejects proposals and invalid reading pages and accepts a real empty response', async () => {
  for (const value of [
    { items: [reading] },
    { items: [{ ...reading, status: 'Proposed' }], page: 1, pageSize: 20, totalCount: 1 },
    { items: [{ ...reading, confirmedValue: null }], page: 1, pageSize: 20, totalCount: 1 },
  ]) {
    await expect(loadTenantReadings(api(value), '/readings', signal)).rejects.toThrow(
      'Dữ liệu tài chính',
    );
  }
  expect(
    await loadTenantReadings(
      api({ items: [], page: 1, pageSize: 20, totalCount: 0 }),
      '/readings',
      signal,
    ),
  ).toEqual({ items: [], page: 1, pageSize: 20, totalCount: 0 });
});
