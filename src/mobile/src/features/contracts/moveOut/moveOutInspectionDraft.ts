import { quantityFields } from '../../../../../../packages/client-core/src/handoverForm';
import type { MoveInRoomCheckStatus } from '../../../services/moveInHandover';

type DraftRoomCheck = {
  code: string;
  status: MoveInRoomCheckStatus;
  notes: string | null;
  evidenceIds: string[];
};
type DraftAsset = {
  id: string;
  condition: string;
  checked?: boolean;
  notes?: string | null;
  evidenceIds?: string[] | null;
  observedQuantity?: number;
  handedOverQuantity?: number;
  goodQuantity?: number;
  wornQuantity?: number;
  damagedQuantity?: number;
  physicalObservations?: {
    id: string;
    quantity: number;
    condition: string;
    handedOverQuantity?: number;
  }[];
};
type PhysicalItemEvidence = {
  assetId: string;
  physicalAssetId: string;
  notes: string;
  evidenceIds: string[];
};
export type InspectionDraft = {
  contractId: string;
  status: 'Draft';
  version: number;
  roomCondition: string | null;
  keysAndAccess: string | null;
  notes: string | null;
  assets: DraftAsset[];
  physicalItemEvidence?: PhysicalItemEvidence[];
  roomChecks: DraftRoomCheck[];
  accessItems: { type: string; quantity: number; notes: string }[];
  evidenceIds: string[];
  keyEvidenceIds: string[];
  electricityReadingId: string | null;
  waterReadingId: string | null;
  inventoryToken: string | null;
  proposedCompensation: string | null;
  updatedAt: string | null;
};
export type DraftPatch = {
  version: number;
  roomCondition?: string;
  notes?: string;
  assets?: DraftAsset[];
  physicalItemEvidence?: PhysicalItemEvidence[];
  roomChecks?: DraftRoomCheck[];
  accessItems?: { type: string; quantity: number; notes: string }[];
  evidenceIds?: string[];
  keyEvidenceIds?: string[];
  electricityReadingId?: string;
  waterReadingId?: string;
  inventoryToken?: string;
};
type LocalInspection = {
  values: Record<string, string>;
  photos: Record<string, string[]>;
};

export function draftToLocal(draft: InspectionDraft): LocalInspection {
  const values: Record<string, string> = {};
  const photos: Record<string, string[]> = {
    general: draft.evidenceIds ?? [],
    keys: draft.keyEvidenceIds ?? [],
  };
  if (draft.electricityReadingId) values.electricityReadingId = draft.electricityReadingId;
  if (draft.waterReadingId) values.waterReadingId = draft.waterReadingId;
  if (draft.roomCondition) values.roomCondition = draft.roomCondition;
  if (draft.notes) values.notes = draft.notes;
  for (const check of draft.roomChecks ?? []) {
    values[`room.${check.code}.status`] = check.status;
    values[`room.${check.code}.notes`] = check.notes ?? '';
    photos[`room:${check.code}`] = check.evidenceIds ?? [];
  }
  for (const asset of draft.assets ?? []) {
    values[`asset-${asset.id}`] = ['Tốt', 'Good', 'Passed'].includes(asset.condition)
      ? 'Good'
      : asset.condition === 'Missing'
        ? 'Missing'
        : 'Damaged';
    values[`${asset.id}.checked`] = asset.checked === false ? 'false' : 'true';
    values[`${asset.id}.notes`] = asset.notes ?? '';
    photos[`asset:${asset.id}`] = asset.evidenceIds ?? [];
    for (const [field] of quantityFields)
      if (typeof asset[field] === 'number') values[`${asset.id}.${field}`] = String(asset[field]);
  }
  const keys = (draft.accessItems ?? []).find((item) => item.type === 'RoomKey');
  if (keys) {
    values.keyQuantity = String(keys.quantity);
    values.keyNotes = keys.notes ?? '';
  }
  return { values, photos };
}
