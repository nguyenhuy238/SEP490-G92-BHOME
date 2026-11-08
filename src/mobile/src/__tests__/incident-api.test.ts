import { expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  incidentClient,
  incidentMultipart,
  validateIncidentPhoto,
  workActions,
  incidentError,
  type WorkOrder,
} from '../services/incidents';
import { MobileApi, MobileApiError } from '../lib/api';

const key = '11111111-1111-4111-8111-111111111111';
const input = {
  locationId: key,
  roomId: key,
  commonArea: null,
  assetId: null,
  severity: 'Emergency' as const,
  description: 'Ống nước bị vỡ, cần kiểm tra ngay.',
};
const photo = {
  id: key,
  bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  contentType: 'image/png' as const,
};
it('sends UTF-8 multipart with real image bytes, correct content type, bearer auth and idempotency key', async () => {
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(JSON.stringify({ incidentId: key, workOrderId: null, resourceId: null }), {
      status: 201,
    }),
  );
  const api = new MobileApi(
    'https://api.example.invalid',
    () => 'synthetic-token',
    async () => undefined,
    vi.fn(),
    fetcher as typeof fetch,
  );
  expect((await incidentClient(api).submit(input, [photo], key)).incidentId).toBe(key);
  const [url, init] = fetcher.mock.calls[0];
  expect(url).toBe('https://api.example.invalid/api/v1/incidents');
  const headers = new Headers(init?.headers);
  expect(headers.get('Authorization')).toBe('Bearer synthetic-token');
  expect(headers.get('Idempotency-Key')).toBe(key);
  expect(headers.get('Content-Type')).toBe(`multipart/form-data; boundary=bhome-${key}`);
  const text = new TextDecoder().decode(init!.body as Uint8Array);
  expect(text).toContain(input.description);
  expect(text).toContain('name="severity"\r\n\r\n1\r\n');
  expect(text).toContain('name="images"; filename="evidence-0.png"');
  expect(text).not.toContain('name="category"');
  expect(text).not.toContain('name="title"');
  expect(text.endsWith(`--bhome-${key}--\r\n`)).toBe(true);
});
it('does not retry a POST on an ambiguous network failure', async () => {
  const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
  const api = new MobileApi(
    'https://api.example.invalid',
    () => 'synthetic',
    async () => undefined,
    vi.fn(),
    fetcher as typeof fetch,
  );
  await expect(incidentClient(api).submit(input, [], key)).rejects.toMatchObject({
    code: 'network_unavailable',
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('keeps WorkOrder routes separate and uses binary PUT with exact evidence enum values', async () => {
  const request = vi.fn().mockResolvedValue({ incidentId: key, resourceId: key });
  const client = incidentClient({ request });
  await client.workCommand(
    key,
    'proposal',
    {
      version: 7,
      inspectionResult: 'Kiểm tra',
      solution: 'Thay ống',
      estimatedMinutes: 30,
      estimatedCost: 0,
      evidenceIds: [],
    },
    key,
  );
  expect(request.mock.calls[0][0]).toBe(`/api/v1/work-orders/${key}/proposal`);
  expect(JSON.parse(request.mock.calls[0][1].body)).toMatchObject({ version: 7, estimatedCost: 0 });
  await client.upload(key, key, 'Completion', photo, key);
  expect(request.mock.calls[1][0]).toBe(
    `/api/v1/incidents/${key}/evidence?kind=3&workOrderId=${key}`,
  );
  expect(request.mock.calls[1][1]).toMatchObject({
    method: 'PUT',
    body: photo.bytes,
    headers: { 'Content-Type': 'image/png', 'Idempotency-Key': key },
  });
  await client.evidence(key, key);
  expect(request.mock.calls[2]).toEqual([
    `/api/v1/incidents/${key}/evidence/${key}`,
    { signal: undefined },
    'bytes',
  ]);
});
it('enforces the backend byte limit rather than the larger MiB limit', () => {
  expect(validateIncidentPhoto(photo.bytes)).toBe('');
  expect(validateIncidentPhoto(new Uint8Array(5_000_001))).toContain('5.000.000');
  expect(validateIncidentPhoto(new Uint8Array([1, 2, 3]))).toContain('PNG');
  expect(() => incidentMultipart(input, Array(6).fill(photo), key)).toThrow();
});
it('gates work actions by assignee, role, approval and workflow state', () => {
  const w = {
    assignedStaffId: key,
    status: 'Assigned',
    canStart: false,
    planApproved: false,
  } as WorkOrder;
  expect(workActions(w, 'Tenant', key)).toEqual([]);
  expect(workActions(w, 'Staff', 'other-staff')).toEqual([]);
  expect(workActions(w, 'Staff', key)).toEqual(['proposal']);
  expect(workActions({ ...w, status: 'PendingApproval' }, 'Staff', key)).not.toContain('start');
  expect(
    workActions(
      { ...w, status: 'PendingApproval', canStart: true, planApproved: true },
      'Staff',
      key,
    ),
  ).toContain('start');
  expect(workActions({ ...w, status: 'InProgress' }, 'Staff', key)).toEqual([
    'progress',
    'blocker',
    'submit',
  ]);
  expect(workActions({ ...w, status: 'PendingVerification' }, 'Owner', key)).toEqual([
    'reassign',
    'cancel',
    'verify',
    'rework',
  ]);
  expect(workActions({ ...w, status: 'Verified' }, 'Owner', key)).toEqual([]);
});
it('preserves backend status/code/correlation diagnostics on stale data', () => {
  const error = incidentError(
    new MobileApiError(
      409,
      'stale_version',
      '/api/v1/incidents/x/review',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'POST',
    ),
  );
  expect(error).toContain('Dữ liệu đã thay đổi');
  expect(error).toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
});
it('checks the canonical controller roots and command endpoints against the actual C# source', () => {
  const incident = readFileSync(
    new URL(
      '../../../backend/BHome.Api/Controllers/IncidentMaintenance/IncidentReportsController.cs',
      import.meta.url,
    ),
    'utf8',
  );
  const work = readFileSync(
    new URL(
      '../../../backend/BHome.Api/Controllers/IncidentMaintenance/WorkOrdersController.cs',
      import.meta.url,
    ),
    'utf8',
  );
  expect(incident).toContain('Route("api/v1/incidents")');
  expect(work).toContain('Route("api/v1/work-orders")');
  for (const action of [
    'review',
    'reject',
    'duplicate',
    'cancel',
    'resolve',
    'work-orders',
    'direct-completion',
    'acknowledge',
    'emergency-actions',
  ])
    expect(incident).toContain(`{id:guid}/${action}`);
  for (const action of [
    'reassign',
    'proposal',
    'plan-decision',
    'start',
    'progress',
    'blocker',
    'submit',
    'verify',
    'rework',
    'cancel',
  ])
    expect(work).toContain(`{id:guid}/${action}`);
});
