import { describe, expect, it, vi } from 'vitest';
import {
  actionPayload,
  contractActions,
  contractClient,
  contractError,
  dateOnly,
  draftPayload,
  formatContractMoney,
  localSchedule,
  mutationKeys,
  vnd,
  type ContractRequest,
  type ContractView,
  type MoveOut,
} from '../../../packages/client-core/src/contracts';
import { MobileApi } from '../../../src/mobile/src/lib/api';
import { createApiClient } from '../../../packages/client-core/src/api';
import { formatInstant } from '../../../packages/client-core/src/localization';
const owner = '00000000-0000-0000-0000-000000000001',
  tenant = '00000000-0000-0000-0000-000000000002',
  id = '00000000-0000-0000-0000-000000000003',
  resident = '00000000-0000-0000-0000-000000000004';
const draft: ContractView = {
  id,
  roomId: id,
  locationId: id,
  kind: 'Main',
  status: 'Draft',
  startDate: '2026-10-01',
  endDate: '2027-10-01',
  monthlyRent: '3000000',
  requiredDeposit: '3000000',
  terms: 'Synthetic terms',
  previousContractId: null,
  residentIds: [resident],
  signatures: [],
  activatedAt: null,
  ownerSignerId: owner,
  tenantUserId: tenant,
  representativeResidentId: resident,
  holdingContractId: null,
  appliedHoldingDeposit: '0',
};
const move = (status: string): MoveOut => ({
  id,
  status,
  proposedDate: '2026-10-30',
  reason: 'Synthetic',
  inspectionScheduledAt: '2026-10-30T03:00:00Z',
  pendingReason: '',
  inspectionNotes: null,
  inspectedAt: null,
  electricityReadingId: null,
  waterReadingId: null,
  evidenceIds: [],
});
const operations = (c: ContractView, m: MoveOut | null, role: string, actor = owner) =>
  contractActions(c, m, role, actor).map((a) => a.operation);
describe('contract role and state actions', () => {
  it('excludes Owner decisions and signing from Staff, and exposes preparation only for valid state', () => {
    expect(operations(draft, null, 'Staff')).toEqual([]);
    expect(operations({ ...draft, status: 'Active' }, null, 'Staff')).toEqual(['renewals']);
    expect(operations({ ...draft, status: 'Active' }, move('Approved'), 'Staff')).toEqual([
      'move-out/schedule',
      'move-out/inspection',
    ]);
    expect(operations({ ...draft, status: 'Active' }, move('PendingSettlement'), 'Staff')).toEqual(
      [],
    );
  });
  it('only a matching signer may sign, while Tenant never sees deposit/activation decisions', () => {
    expect(operations(draft, null, 'Tenant', tenant)).toEqual(['signing']);
    expect(operations(draft, null, 'Tenant', id)).toEqual([]);
    expect(operations({ ...draft, status: 'Active' }, null, 'Tenant', id)).toEqual([]);
    expect(operations(draft, null, 'Owner', id)).not.toContain('signing');
    expect(operations({ ...draft, status: 'Active' }, null, 'Tenant', tenant)).toEqual([
      'termination-requests',
    ]);
    expect(operations({ ...draft, status: 'Active' }, move('Requested'), 'Tenant', tenant)).toEqual(
      [],
    );
  });
  it('never resends an ambiguous signing request or infers Signed from dispatch/recovery', () => {
    const c = {
      ...draft,
      status: 'PendingSigning',
      signatures: [{ id, signerUserId: owner, status: 'ManualReview', signedAt: null }],
    };
    expect(operations(c, null, 'Owner')).toContain('signing/recover');
    expect(operations(c, null, 'Owner')).not.toContain('signing');
    expect(operations(c, null, 'Tenant', tenant)).not.toContain('signing');
    const recovered = { ...c, signatures: [{ ...c.signatures[0]!, status: 'Pending' }] };
    expect(operations(recovered, null, 'Owner')).toContain('signing/sync');
    expect(operations(recovered, null, 'Owner')).not.toContain('signing/recover');
  });
  it('gates completion on Settled and never offers editing a signed version', () => {
    const c = { ...draft, status: 'Active' };
    expect(operations(c, move('PendingSettlement'), 'Owner')).not.toContain('move-out/complete');
    expect(operations(c, move('Settled'), 'Owner')).toContain('move-out/complete');
    expect(
      operations({ ...draft, kind: 'Renewal', previousContractId: id }, null, 'Owner'),
    ).not.toContain('deposit-verifications');
    expect(operations({ ...draft, status: 'Terminated' }, move('Completed'), 'Owner')).toEqual([]);
  });
});
describe('contract input and exact Vietnamese values', () => {
  it.each(['-1', '1.5', '1e6', '3,000,000', '1000000000000000000', '', '01'])(
    'rejects invalid VND %s',
    (v) => expect(() => vnd(v)).toThrow(),
  );
  it('preserves 18-digit amounts without JS Number conversion', () => {
    expect(vnd('999999999999999999')).toBe('999999999999999999');
    expect(formatContractMoney('999999999999999999')).toContain('999.999.999.999.999.999');
    expect(() => vnd('0', true)).toThrow();
    expect(vnd('0')).toBe('0');
  });
  it('validates real calendar dates and converts Vietnam schedules independently of machine timezone', () => {
    expect(dateOnly('29/02/2028')).toBe('2028-02-29');
    expect(() => dateOnly('31/04/2027')).toThrow();
    expect(() => dateOnly('2027-02-29')).toThrow();
    expect(localSchedule('2099-01-01T10:30')).toBe('2099-01-01T03:30:00.000Z');
    expect(() => localSchedule('2099-01-01T24:00')).toThrow();
    expect(formatInstant('2026-10-29T18:05:00Z')).toContain('30/10/2026');
  });
  it('requires representative among verified-selected residents and rejects invalid terms/date/rent', () => {
    const values = {
      roomId: id,
      ownerSignerId: owner,
      tenantUserId: tenant,
      representativeResidentId: resident,
      startDate: '01/01/2027',
      endDate: '01/01/2028',
      monthlyRent: '999999999999999999',
      requiredDeposit: '0',
      terms: 'Synthetic',
    };
    expect(draftPayload(values, [resident]).monthlyRent).toBe('999999999999999999');
    expect(() => draftPayload(values, [])).toThrow();
    expect(() => draftPayload(values, [owner])).toThrow();
    expect(() => draftPayload({ ...values, endDate: values.startDate }, [resident])).toThrow();
    expect(() => draftPayload({ ...values, monthlyRent: '0' }, [resident])).toThrow();
  });
  it('requires expiry extension and confirmed final readings plus evidence', () => {
    const c = { ...draft, status: 'Active' };
    const renewal = contractActions(c, null, 'Staff', id)[0]!;
    expect(() =>
      actionPayload(
        renewal,
        { endDate: '01/10/2027', monthlyRent: '4000000', terms: 'Synthetic' },
        c,
      ),
    ).toThrow();
    const inspection = contractActions(c, move('Approved'), 'Staff', id).find(
      (a) => a.operation === 'move-out/inspection',
    )!;
    expect(() =>
      actionPayload(
        inspection,
        { electricityReadingId: owner, waterReadingId: tenant, notes: 'Synthetic' },
        c,
        [],
      ),
    ).toThrow();
    expect(
      actionPayload(
        inspection,
        { electricityReadingId: owner, waterReadingId: tenant, notes: 'Synthetic' },
        c,
        [resident],
      ),
    ).toMatchObject({ evidenceIds: [resident] });
  });
});
describe('contract transport and safe retries', () => {
  it('keeps operation keys through an uncertain response, isolates payloads, and clears on confirmation', () => {
    let serial = 0;
    const keys = mutationKeys(() => String(++serial));
    const body = { amount: '100' };
    const key = keys.get(id, body);
    expect(keys.get(id, { amount: '100' })).toBe(key);
    expect(keys.get(id, { amount: '200' })).not.toBe(key);
    expect(keys.get(tenant, body)).not.toBe(key);
    keys.confirmed(id, body);
    expect(keys.get(id, body)).not.toBe(key);
  });
  it('sends authenticated mutations with stable keys, preserves binary content and supports query pagination', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response('{}', { status: 200 }));
    const mobile = new MobileApi(
      'https://api.test',
      () => 'synthetic-token',
      async () => undefined,
      () => {},
      fetcher,
    );
    const api = contractClient((path, init, type) => mobile.request(path, init, type));
    fetcher.mockResolvedValueOnce(
      new Response(JSON.stringify({ items: [], page: 2, pageSize: 20, totalCount: 0 })),
    );
    await api.list(2, 'Draft');
    expect(fetcher.mock.calls[0]![0]).toContain('page=2&pageSize=20&status=Draft');
    await api.mutate(id, 'deposit-verifications', { amount: '100' }, owner);
    const init = fetcher.mock.calls[1]![1]!;
    expect(new Headers(init.headers).get('Idempotency-Key')).toBe(owner);
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer synthetic-token');
    expect(init.credentials).toBe('omit');
    fetcher.mockResolvedValueOnce(new Response(new Uint8Array([137, 80, 78, 71])));
    expect(await api.evidenceBytes(id, resident)).toEqual(new Uint8Array([137, 80, 78, 71]));
    await api.upload(id, new Uint8Array([1, 2]), 'image/jpeg');
    expect(new Headers(fetcher.mock.calls[3]![1]!.headers).get('Content-Type')).toBe('image/jpeg');
  });
  it('does not retry 409 or 503 and never displays raw provider/problem details', async () => {
    const request = vi
      .fn<ContractRequest>()
      .mockRejectedValue({ status: 503, problem: { title: 'PRIVATE_PROVIDER_BODY' } });
    await expect(
      contractClient(request).mutate(id, 'signing', { certificateId: owner }, tenant),
    ).rejects.toMatchObject({ status: 503 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(
      contractError({ status: 503, problem: { title: 'PRIVATE_PROVIDER_BODY' } }),
    ).not.toContain('PRIVATE');
    expect(contractError({ status: 409, code: 'security_deposit_insufficient' })).toContain(
      'chưa đủ',
    );
  });
  it('web transport downloads private files with bearer, retains explicit MIME, and uses no-store', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response(new Uint8Array([137, 80, 78, 71]), { status: 200 }),
      );
    vi.stubGlobal('fetch', transport);
    try {
      const api = contractClient(createApiClient('https://api.test', () => 'SYNTHETIC'));
      const file = await api.evidence(id, resident);
      expect(await file.arrayBuffer()).toEqual(new Uint8Array([137, 80, 78, 71]).buffer);
      const init = transport.mock.calls[0]![1]!;
      expect(new Headers(init.headers).get('Authorization')).toBe('Bearer SYNTHETIC');
      expect(init.cache).toBe('no-store');
      expect(init.credentials).toBe('omit');
      transport.mockImplementation(async () => new Response('{}', { status: 200 }));
      await api.upload(id, new Uint8Array([1, 2]), 'image/png');
      expect(new Headers(transport.mock.calls[1]![1]!.headers).get('Content-Type')).toBe(
        'image/png',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
