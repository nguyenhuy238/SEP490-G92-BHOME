import { describe, expect, it, vi } from 'vitest';
import {
  MobileApi,
  MobileApiError,
  apiBaseUrl,
  errorMessage,
} from '../../../src/mobile/src/lib/api';
import {
  confirmedIdentity,
  emptyIdentity,
  inputDate,
  mergeIdentity,
} from '../../../src/mobile/src/lib/identity';

describe('mobile transport privacy and binary upload', () => {
  it.each([
    'http://192.168.1.2:7240',
    'https://user:password@api.test',
    'https://api.test/path',
    'https://api.test?key=x',
  ])('rejects unsafe API base %s', (value) => expect(() => apiBaseUrl(value)).toThrow());
  it('preserves JPEG content type and sends bearer with raw bytes, without cookies', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}', { status: 200 }));
    const api = new MobileApi(
      'https://api.test',
      () => 'synthetic-token',
      async () => undefined,
      () => {},
      transport,
    );
    const bytes = new Uint8Array([1, 2, 3]);
    await api.image(
      '/api/v1/ocr/identity/00000000-0000-0000-0000-000000000001/front',
      bytes,
      new AbortController().signal,
    );
    const request = transport.mock.calls[0]![1]!;
    expect(new Headers(request.headers).get('Content-Type')).toBe('image/jpeg');
    expect(new Headers(request.headers).get('Authorization')).toBe('Bearer synthetic-token');
    expect(request.credentials).toBe('omit');
    expect(request.body).toBe(bytes);
  });
  it('retries once after 401 refresh but never retries a conflict or ambiguous network failure', async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const refresh = vi.fn().mockResolvedValue('rotated-token');
    const api = new MobileApi(
      'https://api.test',
      () => 'old',
      refresh,
      () => {},
      transport,
    );
    await api.json('/api/v1/capture/residents/id/confirm', {});
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(transport).toHaveBeenCalledTimes(2);
    transport
      .mockReset()
      .mockResolvedValue(
        new Response('{"code":"identity_already_confirmed","title":"PRIVATE"}', { status: 409 }),
      );
    await expect(api.json('/api/v1/capture/residents/id/confirm', {})).rejects.toMatchObject({
      status: 409,
    });
    expect(transport).toHaveBeenCalledTimes(1);
    transport.mockReset().mockRejectedValue(new Error('PRIVATE_NETWORK_DETAIL'));
    await expect(api.json('/api/v1/capture/residents/id/confirm', {})).rejects.toMatchObject({
      status: 0,
    });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(errorMessage(new MobileApiError(409, 'identity_already_confirmed'))).not.toContain(
      'PRIVATE',
    );
  });
});
describe('identity proposals', () => {
  it('validates actual calendar dates and keeps them independent of timezone', () => {
    expect(inputDate('29/02/2000')).toBe('2000-02-29');
    expect(() => inputDate('29/02/2001')).toThrow();
    expect(() => inputDate('31/04/2000')).toThrow();
    expect(() => inputDate('2000-01-01')).toThrow();
  });
  it('does not overwrite conflicting values from the other card side', () => {
    const before = { ...emptyIdentity(), fullName: 'NGƯỜI KIỂM THỬ' };
    const merged = mergeIdentity(before, {
      proposedFields: { fullName: 'KHÁC', dateOfBirth: '2000-01-01' },
      warnings: [],
      missingFields: [],
      confidence: {},
      isFallback: false,
      requiresConfirmation: true,
    });
    expect(merged.fields.fullName).toBe(before.fullName);
    expect(merged.conflicts).toEqual(['fullName']);
    expect(merged.fields.dateOfBirth).toBe('01/01/2000');
  });
  it('manual entry uses the same explicit confirmation payload and does not invent missing identity', () => {
    expect(() => confirmedIdentity(emptyIdentity())).toThrow();
    const data = confirmedIdentity({
      ...emptyIdentity(),
      citizenIdentityNumber: '000000000000',
      fullName: 'NGƯỜI KIỂM THỬ',
      dateOfBirth: '01/01/2000',
    });
    expect(data.humanConfirmed).toBe(true);
    expect(data.dateOfBirth).toBe('2000-01-01');
    expect(data.dateOfIssue).toBeNull();
  });
});
