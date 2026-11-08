import { describe, expect, it, vi } from 'vitest';
import type { MobileApi } from '../lib/api';
import { loadInvoicePaymentStates } from '../services/tenantInvoices';
import {
  ledgerPath,
  ledgerPeriod,
  loadLedgerPage,
  sortLedgerRows,
  verificationLabel,
  type LedgerItem,
} from '../services/tenantPaymentHistory';
const history = {
  id: 'allocation',
  invoiceId: 'invoice',
  locationId: 'location',
  roomId: 'room',
  locationName: 'Test',
  roomNumber: 'P1',
  billingPeriod: '2026-11-01',
  amount: '100000',
  paidAt: '2026-11-07T01:00:00Z',
  paidBy: 'Khách thuê khác trong hóa đơn',
  verificationSource: 'OwnerBankStatement',
  bankReference: 'PRIVATE-BANK',
  verifiedByUserId: 'PRIVATE-VERIFIER',
};
const debt = {
  invoiceId: 'invoice',
  locationId: 'location',
  roomId: 'room',
  locationName: 'Test',
  roomNumber: 'P1',
  billingPeriod: '2026-11-01',
  dueDate: '2026-11-20',
  overdueDays: 0,
  paymentStatus: 'Unpaid',
  payableAmount: '100000',
  paidAmount: '25000',
  outstandingAmount: '75000',
  originalIssuedAmount: '110000',
  approvedAdjustmentTotal: '-10000',
  potentialExcessAmount: '0',
};
function api(value: unknown) {
  return { request: vi.fn().mockResolvedValue(value) } as unknown as MobileApi;
}
const page = (items: unknown[]) => ({ items, page: 1, pageSize: 20, totalCount: items.length });
const signal = () => new AbortController().signal;
describe('Tenant ledger contract and privacy', () => {
  it('loads payment summaries only for invoices requested by the visible list', async () => {
    const result = await loadInvoicePaymentStates(
      api(page([debt])),
      '/api/v1/payment-invoices?pageSize=100&invoiceIds=invoice',
      signal(),
    );
    expect(result.items[0]).toMatchObject({ outstandingAmount: '75000', paymentStatus: 'Unpaid' });
  });
  it.each([
    page([{ ...debt, invoiceId: 'different-invoice' }]),
    page([debt, debt]),
    page([{ ...debt, outstandingAmount: '-1' }]),
    page([{ ...debt, paymentStatus: 'Final' }]),
    null,
  ])('rejects unusable payment summaries instead of inferring paid status %#', async (value) => {
    await expect(
      loadInvoicePaymentStates(
        api(value),
        '/api/v1/payment-invoices?pageSize=100&invoiceIds=invoice',
        signal(),
      ),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('uses only supported filters and normalizes first-of-month billing dates', () => {
    const filters = { period: ledgerPeriod('11/2026'), roomId: 'room', overdueOnly: true };
    expect(ledgerPath('outstanding', 2, filters)).toBe(
      '/api/v1/debts?page=2&pageSize=20&billingPeriod=2026-11-01&roomId=room&overdueOnly=true',
    );
    expect(ledgerPath('verified', 1, filters)).not.toContain('overdueOnly');
    expect(() => ledgerPeriod('13/2026')).toThrow();
    expect(() => ledgerPeriod('11/0000')).toThrow();
  });
  it('drops private metadata even when unexpectedly supplied to a Tenant', async () => {
    const data = await loadLedgerPage(
      api(page([history])),
      '/api/v1/payment-history?page=1&pageSize=20',
      signal(),
    );
    expect(data.items[0]).toMatchObject({
      paidBy: history.paidBy,
      bankReference: null,
      verifiedByUserId: null,
    });
    expect(verificationLabel('unrecognized-provider')).toBe('Nguồn xác minh khác');
  });
  it.each([
    null,
    { items: {} },
    page([{ ...history, paidAt: 'invalid' }]),
    page([{ ...history, amount: 100000 }]),
    page([history, history]),
  ])('rejects malformed history %#', async (value) => {
    await expect(
      loadLedgerPage(api(value), '/api/v1/payment-history?page=1&pageSize=20', signal()),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('accepts nullable financials, signed adjustments and zero without rewriting status', async () => {
    const value = {
      ...debt,
      payableAmount: null,
      paidAmount: null,
      originalIssuedAmount: null,
      approvedAdjustmentTotal: null,
      potentialExcessAmount: null,
      outstandingAmount: '0',
      paymentStatus: 'Paid',
    };
    const data = await loadLedgerPage(
      api(page([value])),
      '/api/v1/debts?page=1&pageSize=20',
      signal(),
    );
    expect(data.items[0]).toEqual(value);
    const adjusted = await loadLedgerPage(
      api(page([debt])),
      '/api/v1/debts?page=1&pageSize=20',
      signal(),
    );
    expect(adjusted.items[0]).toMatchObject({
      approvedAdjustmentTotal: '-10000',
      outstandingAmount: '75000',
    });
  });
  it.each([
    { ...debt, payableAmount: {} },
    { ...debt, outstandingAmount: '-5' },
    { ...debt, overdueDays: -1 },
    { ...debt, dueDate: '2026-02-31' },
  ])('rejects invalid debt %#', async (value) => {
    await expect(
      loadLedgerPage(api(page([value])), '/api/v1/debts?page=1&pageSize=20', signal()),
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });
  it('sorts only supplied rows with exact numeric-string comparison beyond Number precision', () => {
    const first = { ...history, id: 'first', amount: '9007199254740992' };
    const second = { ...history, id: 'second', amount: '9007199254740993' };
    const rows: LedgerItem[] = [first, second];
    expect(sortLedgerRows(rows, 'amount')).toEqual([second, first]);
    expect(rows).toEqual([first, second]);
  });
});
