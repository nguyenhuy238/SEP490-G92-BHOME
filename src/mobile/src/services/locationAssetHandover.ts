import { guid } from '../../../../packages/client-core/src/contracts';
import type { MobileApi } from '../lib/api';

export interface LocationAssetHandoverAcceptance {
  actorId: string;
  signedAt: string;
  method: string;
  snapshotSha256: string;
}

export interface LocationAssetHandoverReport {
  taskId: string;
  locationId: string;
  assignmentId: string;
  staffId: string;
  taskVersion: number;
  revision: number;
  status: 'PendingOwnerSignature' | 'PendingStaffSignature' | 'Completed' | 'Superseded';
  totalItems: number;
  directItems: number;
  inheritedItems: number;
  snapshotSha256: string;
  pdfSha256: string;
  approvedAt: string;
  approvedBy: string;
  exceptionDecision: string | null;
  ownerSignature: LocationAssetHandoverAcceptance | null;
  staffSignature: LocationAssetHandoverAcceptance | null;
  canDownloadFinal: boolean;
}

export function locationAssetHandoverClient(api: MobileApi) {
  const path = (taskId: string) =>
    `/api/v1/operational-tasks/${guid(taskId)}/location-asset-handover`;
  return {
    get: (taskId: string, signal?: AbortSignal) =>
      api.request<LocationAssetHandoverReport>(path(taskId), { signal }),
    sign: (taskId: string, report: LocationAssetHandoverReport) =>
      api.request<LocationAssetHandoverReport>(`${path(taskId)}/sign`, {
        method: 'POST',
        body: JSON.stringify({
          revision: report.revision,
          snapshotSha256: report.snapshotSha256,
          confirmed: true,
        }),
      }),
    documentBytes: (taskId: string) =>
      api.request<Uint8Array<ArrayBuffer>>(`${path(taskId)}/document`, {}, 'bytes'),
    documentBlob: (taskId: string) =>
      api.request<Blob>(`${path(taskId)}/document`, {}, 'blob'),
  };
}
