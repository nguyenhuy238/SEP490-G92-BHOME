import { describe, expect, it, vi } from 'vitest';
import { validateWorkflow } from '../../../src/mobile/src/features/workflows/validation';
import { canOpenScreen } from '../../../src/mobile/src/features/workspace/navigation';
import { captureService } from '../../../src/mobile/src/services/captureService';
import { MobileApi } from '../../../src/mobile/src/lib/api';

describe('new mobile workflow permissions', () => {
  it.each([
    'onboarding',
    'prepare-contract',
    'move-out',
    'move-in',
    'shifts',
    'rooms',
    'debt-follow-up',
    'task-detail',
    'report-incident',
  ] as const)('restricts %s to Staff', (screen) => {
    expect(canOpenScreen('Staff', screen)).toBe(true);
    expect(canOpenScreen('Owner', screen)).toBe(false);
    expect(canOpenScreen('Tenant', screen)).toBe(false);
  });
  it.each(['residence', 'adjustment', 'contract-request', 'billing-history'] as const)(
    'restricts %s to own Tenant flows',
    (screen) => {
      expect(canOpenScreen('Tenant', screen)).toBe(true);
      expect(canOpenScreen('Staff', screen)).toBe(false);
      expect(canOpenScreen('Owner', screen)).toBe(false);
    },
  );
});
describe('workflow validation before submission', () => {
  const contract = {
    room: 'synthetic-room',
    tenant: 'synthetic-tenant',
    type: 'holding',
    start: '30/10/2026',
    end: '02/11/2026',
    terms: 'Owner-configured policy',
    deposit: '1000000',
  };
  it('accepts a complete holding draft without activating or calculating deposits', () =>
    expect(validateWorkflow('contract', contract, 0)).toEqual([]));
  it('blocks dates in the wrong order and impossible calendar dates', () => {
    expect(
      validateWorkflow('contract', { ...contract, end: '29/10/2026' }, 0).length,
    ).toBeGreaterThan(0);
    expect(
      validateWorkflow('contract', { ...contract, start: '31/02/2026' }, 0).length,
    ).toBeGreaterThan(0);
  });
  it('requires rent and a holding reference when preparing a main contract from holding', () => {
    expect(
      validateWorkflow('contract', { ...contract, type: 'main', source: 'holding' }, 0).length,
    ).toBeGreaterThan(0);
    expect(
      validateWorkflow(
        'contract',
        {
          ...contract,
          type: 'main',
          source: 'holding',
          rent: '4800000',
          holdingRef: 'synthetic-holding',
        },
        0,
      ),
    ).toEqual([]);
  });
  it.each(['-1', 'NaN', 'Infinity', '2e5', '1.000.000'])('rejects invalid money %s', (deposit) =>
    expect(validateWorkflow('contract', { ...contract, deposit }, 0).length).toBeGreaterThan(0),
  );
  it('requires inspection evidence and keys before Owner review', () => {
    const inspection = {
      room: 'synthetic',
      date: '30/10/2026',
      condition: 'Checked',
      electric: '1525.8',
      water: '217',
      keys: '2 keys',
    };
    expect(validateWorkflow('move-out', inspection, 0).length).toBeGreaterThan(0);
    expect(validateWorkflow('move-out', inspection, 1)).toEqual([]);
    expect(validateWorkflow('move-out', { ...inspection, keys: '' }, 1).length).toBeGreaterThan(0);
  });
  it('blocks unsupported progress and missing completion evidence', () => {
    expect(
      validateWorkflow('task', { progress: '101', note: 'result', mode: 'submit' }, 1).length,
    ).toBeGreaterThan(0);
    expect(
      validateWorkflow('task', { progress: '100', note: 'result', mode: 'submit' }, 0).length,
    ).toBeGreaterThan(0);
    expect(
      validateWorkflow(
        'task',
        { progress: '60', note: 'Need coordination', mode: 'blocker', blocker: '' },
        0,
      ).length,
    ).toBeGreaterThan(0);
  });
  it('requires a disputed charge and useful adjustment reason', () =>
    expect(
      validateWorkflow('adjustment', { invoice: 'synthetic', charge: '', reason: 'bad' }, 0).length,
    ).toBeGreaterThan(0));
  it('requires residence evidence and a valid start date', () => {
    const result = { start: '30/10/2026', result: 'submitted', reference: 'synthetic-ref' };
    expect(validateWorkflow('residence', result, 0).length).toBeGreaterThan(0);
    expect(validateWorkflow('residence', result, 1)).toEqual([]);
  });
});
describe('onboarding API adapter', () => {
  it('uses only confirmed capture endpoints, omits raw identity/contact fields and uses bearer isolation', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{"id":"synthetic-id"}', { status: 200 }));
    const api = new MobileApi(
      'https://api.test',
      () => 'synthetic-token',
      async () => undefined,
      () => {},
      transport,
    );
    await captureService(api).createResident('synthetic-room', 'Workspace label', 1);
    const [url, init] = transport.mock.calls[0]!;
    expect(url).toBe('https://api.test/api/v1/capture/residents');
    expect(JSON.parse(init!.body as string)).toEqual({
      roomId: 'synthetic-room',
      displayLabel: 'Workspace label',
      residentType: 1,
    });
    expect(init!.credentials).toBe('omit');
    expect(new Headers(init!.headers).get('Authorization')).toBe('Bearer synthetic-token');
  });
  it('preserves server permission-denied responses instead of falling back to mock rooms', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 403 }));
    const api = new MobileApi(
      'https://api.test',
      () => 'synthetic-token',
      async () => undefined,
      () => {},
      transport,
    );
    await expect(captureService(api).rooms('synthetic-location')).rejects.toMatchObject({
      status: 403,
    });
  });
});
