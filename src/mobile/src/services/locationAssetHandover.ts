import { guid } from '../../../../packages/client-core/src/contracts';
import type { DrawnSignature } from '../../../../packages/client-core/src/signing';
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

export interface LocationAssetHandoverDocumentPreview {
  pageCount: number;
  documentSha256: string;
}

export interface LocationAssetHandoverArchiveListItem {
  taskId: string;
  locationId: string;
  assignmentId: string;
  staffId: string;
  ownerId: string;
  revision: number;
  locationName: string;
  address: string;
  totalItems: number;
  directItems: number;
  inheritedItems: number;
  snapshotSha256: string;
  pdfSha256: string;
  approvedAt: string;
  exceptionDecision: string | null;
  ownerSignature: LocationAssetHandoverAcceptance;
  staffSignature: LocationAssetHandoverAcceptance;
}

export interface LocationAssetHandoverArchiveAsset {
  id: string;
  scope: string;
  name: string;
  quantity: number;
  condition: string;
  inherited: boolean;
  sourceHandoverContractId: string | null;
  incidentId: string | null;
  note: string | null;
  priorStaffTaskId: string | null;
  priorStaffUserId: string | null;
}

export interface LocationAssetHandoverArchiveReport {
  report: LocationAssetHandoverArchiveListItem;
  items: LocationAssetHandoverArchiveAsset[];
}

export function locationAssetHandoverClient(api: MobileApi) {
  const path = (taskId: string) =>
    `/api/v1/operational-tasks/${guid(taskId)}/location-asset-handover`;
  return {
    get: (taskId: string, signal?: AbortSignal) =>
      api.request<LocationAssetHandoverReport>(path(taskId), { signal }),
    sign: (taskId: string, report: LocationAssetHandoverReport, ink: DrawnSignature) =>
      api.request<LocationAssetHandoverReport>(`${path(taskId)}/sign`, {
        method: 'POST',
        body: JSON.stringify({
          revision: report.revision,
          snapshotSha256: report.snapshotSha256,
          confirmed: true,
          ink,
        }),
      }),
    documentPreview: (taskId: string, signal?: AbortSignal) =>
      api.request<LocationAssetHandoverDocumentPreview>(`${path(taskId)}/document/preview`, {
        signal,
      }),
    documentPage: (taskId: string, page: number, signal?: AbortSignal) =>
      api.request<Uint8Array<ArrayBuffer>>(
        `${path(taskId)}/document/pages/${page}`,
        { signal },
        'bytes',
      ),
    documentBytes: (taskId: string) =>
      api.request<Uint8Array<ArrayBuffer>>(`${path(taskId)}/document`, {}, 'bytes'),
    documentBlob: (taskId: string) => api.request<Blob>(`${path(taskId)}/document`, {}, 'blob'),
  };
}

export function locationAssetHandoverArchiveClient(api: MobileApi) {
  const root = '/api/v1/location-asset-handovers/archive';
  const revisionPath = (taskId: string, revision: number) =>
    `${root}/${guid(taskId)}/revisions/${revision}`;
  return {
    list: (signal?: AbortSignal) =>
      api.request<LocationAssetHandoverArchiveListItem[]>(root, { signal }),
    revision: (taskId: string, revision: number, signal?: AbortSignal) =>
      api.request<LocationAssetHandoverArchiveReport>(revisionPath(taskId, revision), { signal }),
    documentBytes: (taskId: string, revision: number) =>
      api.request<Uint8Array<ArrayBuffer>>(
        `${revisionPath(taskId, revision)}/document`,
        {},
        'bytes',
      ),
    documentBlob: (taskId: string, revision: number) =>
      api.request<Blob>(`${revisionPath(taskId, revision)}/document`, {}, 'blob'),
  };
}
