import {
  contactPhoneError,
  normalizeContactPhone,
} from '../../../../../../packages/client-core/src/contactPhone';
import type {
  LocationSetupInput,
  LocationSetupInformation,
  SetupAssetRequirement,
  SetupCommonAssetRequirement,
  SetupFee,
  SetupRoomDefaults,
  SetupSourceReference,
} from '../../../../../../packages/client-core/src/locationSetup';
import type {
  AssetCatalogData,
  FeeTemplateData,
  RoomTemplateData,
  SharedDocument,
} from '../../../../../../packages/client-core/src/sharedConfiguration';
import { todayVietnam } from '../../staff/staffContracts';
import { formatBillingDecimal } from '../../../../../../packages/client-core/src/invoices';
import { suggestedLocationCode } from './locationCode';

export const money = (value: number | string | null) =>
  value === null ? 'Chưa đặt' : formatBillingDecimal(value) + ' đ';
export const norm = (value: string) => value.trim().toLocaleLowerCase();
// Match catalog items also when a copied legacy requirement has no catalog reference.
// Accents/case/spacing must not let an item be added twice to one location.
export const commonAssetKey = (value: string) =>
  value
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase('vi')
    .replace(/\s+/g, ' ');
export const uid = () => crypto.randomUUID();
export const today = () => todayVietnam();
export const validMoney = (value: number | string | null): boolean =>
  value !== null && /^\d{1,14}(?:\.\d{1,4})?$/.test(String(value));
export const feeOverlaps = (
  a: Pick<
    DraftFee,
    'roomKey' | 'requiresRoom' | 'sourceRoomId' | 'chargeCode' | 'effectiveFrom' | 'effectiveTo'
  >,
  b: Pick<
    DraftFee,
    'roomKey' | 'requiresRoom' | 'sourceRoomId' | 'chargeCode' | 'effectiveFrom' | 'effectiveTo'
  >,
) => {
  const sameScope =
    a.requiresRoom || b.requiresRoom
      ? a.requiresRoom &&
        b.requiresRoom &&
        (a.roomKey && b.roomKey
          ? a.roomKey === b.roomKey
          : !a.roomKey && !b.roomKey && !!a.sourceRoomId && a.sourceRoomId === b.sourceRoomId)
      : a.roomKey === b.roomKey;
  return (
    sameScope &&
    a.chargeCode.trim().toUpperCase() === b.chargeCode.trim().toUpperCase() &&
    a.effectiveFrom <= (b.effectiveTo ?? '9999-12-31') &&
    b.effectiveFrom <= (a.effectiveTo ?? '9999-12-31')
  );
};
export const exactRent = (value: string | number): string | number =>
  /^\d{1,14}$/.test(String(value)) ? Number(value) : value;
export const categories = ['Tiền thuê', 'Điện', 'Nước', 'Dịch vụ'];
export type DraftRoom = {
  key: string;
  roomNumber: string;
  floor: string;
  roomTypeKey: string;
  rent: number | string | null;
};
type DraftAsset = SetupAssetRequirement & { references?: SetupSourceReference[] };
export type DraftCommonAsset = SetupCommonAssetRequirement & {
  references?: SetupSourceReference[];
  sourceItemId?: string;
};
export type DraftType = Omit<SetupRoomDefaults, 'assets'> & {
  assets: DraftAsset[];
  assetTemplateSourceName?: string;
  assetTemplateSourceVersion?: number;
};
export type DraftFee = Omit<SetupFee, 'rate'> & {
  rate: number | string;
  key: string;
  sourceId?: string;
  reference?: SetupSourceReference;
  requiresRoom?: boolean;
  sourceRoomId?: string;
};
type RuleSection = {
  key: string;
  title: string;
  content: string;
  sourceId?: string;
  reference?: SetupSourceReference;
};
export type Draft = {
  key: string;
  step: number;
  mode: 'scratch' | 'copy';
  location: LocationSetupInformation;
  activate: boolean;
  sourceLocationId: string;
  appliedSource: string | null;
  sourceState: string | null;
  roomTypes: DraftType[];
  commonAssets: DraftCommonAsset[];
  rooms: DraftRoom[];
  fees: DraftFee[];
  rules: RuleSection[];
  policyTitle: string;
  policyDate: string;
  rentEffectiveFrom: string;
  submittedPayload?: string;
  submittedKey?: string;
};
export const reference = (
  kind: SetupSourceReference['kind'],
  doc: { id: string; version: number },
): SetupSourceReference => ({ id: doc.id, version: doc.version, kind });
const uniqueReferences = (references: SetupSourceReference[]) => [
  ...new Map(references.map((item) => [`${item.kind}:${item.id}:${item.version}`, item])).values(),
];

export type SameFamily = (id: string | null | undefined, doc: SharedDocument) => boolean;
const sameDocument: SameFamily = (id, doc) => id === doc.id;
export const latestDocuments = (documents: SharedDocument[], status: SharedDocument['status']) => {
  const latest = new Map<string, SharedDocument>();
  for (const doc of documents) {
    if (doc.status !== status) continue;
    const previous = latest.get(doc.familyId);
    if (!previous || previous.edition < doc.edition) latest.set(doc.familyId, doc);
  }
  return [...latest.values()];
};

export const matchesCatalog = (asset: DraftAsset, doc: SharedDocument, sameFamily = sameDocument) =>
  asset.references?.some((item) => item.kind === 'asset-catalog' && sameFamily(item.id, doc)) ||
  norm(asset.name) === norm(doc.name);
export const matchesCommonCatalog = (
  asset: DraftCommonAsset,
  doc: SharedDocument,
  sameFamily = sameDocument,
) =>
  asset.references?.some((item) => item.kind === 'asset-catalog' && sameFamily(item.id, doc)) ||
  commonAssetKey(asset.name) === commonAssetKey(doc.name);

export const matchesRoomTemplate = (
  type: DraftType,
  doc: SharedDocument,
  sameFamily = sameDocument,
) => sameFamily(type.sourceId, doc) || norm(type.name) === norm(doc.name);

export const matchesFeeTemplate = (
  fee: DraftFee,
  doc: SharedDocument,
  sameFamily = sameDocument,
) => {
  const data = doc.data as FeeTemplateData;
  return (
    sameFamily(fee.sourceId, doc) ||
    (data.scope === 'Location' &&
      !fee.requiresRoom &&
      fee.roomKey === null &&
      feeOverlaps(fee, {
        roomKey: null,
        chargeCode: data.chargeCode,
        effectiveFrom: feeDate(data.effectiveFrom),
        effectiveTo: data.effectiveTo && data.effectiveTo >= today() ? data.effectiveTo : null,
      }))
  );
};

export function mergeCatalogAssets(
  assets: DraftAsset[],
  documents: SharedDocument[],
  sameFamily = sameDocument,
): DraftAsset[] {
  const merged = [...assets];
  for (const doc of documents) {
    if (doc.resource !== 'asset-catalog' || doc.status !== 'Published') continue;
    const index = merged.findIndex((asset) => matchesCatalog(asset, doc, sameFamily));
    const imported = reference('asset-catalog', doc);
    if (index >= 0) {
      const existing = merged[index];
      if (
        existing.references?.some(
          (item) => item.kind === 'asset-catalog' && sameFamily(item.id, doc),
        )
      )
        continue;
      merged[index] = {
        ...existing,
        referencePrice: (doc.data as AssetCatalogData).referencePrice,
        references: uniqueReferences([...(existing.references ?? []), imported]),
      };
    } else {
      merged.push({
        name: doc.name,
        category: (doc.data as AssetCatalogData).category,
        quantity: 1,
        trackingMode: 'BulkQuantity',
        unit: (doc.data as AssetCatalogData).unit,
        referencePrice: (doc.data as AssetCatalogData).referencePrice,
        references: [imported],
      });
    }
  }
  return merged;
}

export const newType = (): DraftType => ({
  key: uid(),
  name: '',
  description: '',
  capacity: 2,
  area: 20,
  referenceRent: null,
  amenities: [],
  assets: [],
  sourceId: null,
  sourceVersion: null,
  sourceKind: null,
});
export const newDraft = (source?: string): Draft => ({
  key: uid(),
  step: 0,
  mode: source ? 'copy' : 'scratch',
  location: {
    name: '',
    address: '',
    code: '',
    floors: 1,
    contactPhone: '',
    contactEmail: '',
    description: '',
  },
  activate: true,
  sourceLocationId: source ?? '',
  appliedSource: null,
  sourceState: null,
  roomTypes: [],
  commonAssets: [],
  rooms: [],
  fees: [],
  rules: [],
  policyTitle: 'Nội quy cơ sở',
  policyDate: today(),
  rentEffectiveFrom: today(),
});
export const categoryNumber = (value: string | number): SetupFee['category'] => {
  if (typeof value === 'number' && value >= 0 && value <= 3) return value as SetupFee['category'];
  const index = ['RENT', 'ELECTRICITY', 'WATER', 'SERVICEFEE'].indexOf(
    String(value).replace(/_/g, '').toUpperCase(),
  );
  return index < 0 ? 3 : (index as SetupFee['category']);
};
export const methodNumber = (value: string | number): SetupFee['method'] =>
  value === 1 || String(value).toUpperCase() === 'METERED'
    ? 1
    : value === 2 || String(value).toUpperCase() === 'FIXEDPERPERSONPERMONTH'
      ? 2
      : 0;
export const feeUnitLabel = (category: SetupFee['category'], method: SetupFee['method']) =>
  method === 2 ? 'người/tháng' : method === 1 ? (category === 2 ? 'm³' : 'kWh') : 'phòng/tháng';
export const dateLabel = (value: string) => value.split('-').reverse().join('/');
export const feeDate = (value: string) => (value >= today() ? value : today());
export const sourceType = (document: SharedDocument): DraftType => {
  const data = document.data as RoomTemplateData;
  return {
    ...newType(),
    name: document.name,
    description: document.description,
    capacity: data.capacity,
    area: Number(data.area),
    referenceRent: data.referenceRent === null ? null : exactRent(data.referenceRent),
    amenities: [...data.amenities],
    assets: (data.assetItems ?? []).flatMap((item) =>
      item.catalog
        ? [
            {
              name: item.catalog.name,
              category: item.catalog.category,
              unit: item.catalog.unit,
              referencePrice: item.catalog.referencePrice,
              quantity: item.quantity,
              trackingMode: item.trackingMode,
            },
          ]
        : [],
    ),
    sourceId: document.id,
    sourceVersion: document.version,
    sourceKind: 'SharedTemplate',
  };
};

export function validateSetupStep(draft: Draft, step: number): string | null {
  if (step === 0) {
    const info = draft.location;
    if (
      info.name.trim().length < 2 ||
      info.name.trim().length > 200 ||
      !info.address.trim() ||
      info.address.trim().length > 1000 ||
      !Number.isInteger(info.floors) ||
      info.floors < 1 ||
      info.floors > 100
    )
      return 'Nhập tên, địa chỉ và số tầng hợp lệ.';
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(suggestedLocationCode(info.name)))
      return 'Không thể tạo mã cơ sở từ tên đã nhập.';
    if (
      !!contactPhoneError(info.contactPhone) ||
      info.contactEmail.trim().length > 200 ||
      info.description.trim().length > 2000
    )
      return (
        contactPhoneError(info.contactPhone) || 'Thông tin liên hệ hoặc mô tả vượt độ dài cho phép.'
      );
    if (info.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(info.contactEmail.trim()))
      return 'Email liên hệ không hợp lệ.';
    if (draft.mode === 'copy' && !draft.appliedSource)
      return 'Chọn và nạp ít nhất một cấu hình nguồn hoặc chuyển sang Tạo mới.';
  }
  if (step === 1) {
    if (!draft.roomTypes.length) return 'Chọn ít nhất một loại phòng hoặc tạo loại phòng mới.';
    if (
      draft.roomTypes.some(
        (type) =>
          type.name.trim().length < 2 ||
          !Number.isInteger(type.capacity) ||
          type.capacity < 1 ||
          type.capacity > 32767 ||
          !Number.isFinite(type.area) ||
          type.area <= 0 ||
          type.area > 1000000,
      )
    )
      return 'Mỗi loại phòng cần tên, diện tích và sức chứa hợp lệ.';
    if (new Set(draft.roomTypes.map((type) => norm(type.name))).size !== draft.roomTypes.length)
      return 'Tên loại phòng không được trùng trong cơ sở.';
    if (draft.roomTypes.some((type) => !validMoney(type.referenceRent)))
      return 'Nhập giá thuê mặc định hợp lệ cho từng loại phòng.';
  }
  if (step === 2) {
    if (!draft.rentEffectiveFrom || draft.rentEffectiveFrom < today())
      return 'Chọn ngày hiệu lực giá thuê từ hôm nay trở đi.';
    if (!draft.rooms.length) return 'Tạo ít nhất một phòng trước khi tiếp tục.';
    if (
      draft.rooms.some(
        (room) =>
          !room.roomNumber.trim() ||
          room.roomNumber.length > 50 ||
          !draft.roomTypes.some((type) => type.key === room.roomTypeKey) ||
          !Number.isInteger(Number(room.floor)) ||
          Number(room.floor) < 1 ||
          Number(room.floor) > draft.location.floors ||
          (room.rent !== null && !validMoney(room.rent)),
      )
    )
      return 'Kiểm tra mã, tầng, loại phòng và giá riêng của từng phòng.';
    if (new Set(draft.rooms.map((room) => norm(room.roomNumber))).size !== draft.rooms.length)
      return 'Mã phòng bị trùng.';
  }
  if (
    step === 3 &&
    draft.roomTypes.some((type) =>
      type.assets.some(
        (asset) =>
          !asset.name.trim() ||
          !Number.isInteger(asset.quantity) ||
          asset.quantity < 1 ||
          asset.quantity > 10000,
      ),
    )
  )
    return 'Kiểm tra tên và số lượng tài sản; mỗi số lượng phải từ 1 đến 10.000.';
  if (
    step === 3 &&
    (draft.commonAssets.length > 100 ||
      draft.commonAssets.some(
        (asset) =>
          !asset.name.trim() ||
          !asset.commonArea.trim() ||
          asset.commonArea.trim().length > 200 ||
          !Number.isInteger(asset.quantity) ||
          asset.quantity < 1 ||
          asset.quantity > 10000,
      ))
  )
    return 'Tối đa 100 mục tài sản chung. Nhập khu vực sử dụng (tối đa 200 ký tự) và số lượng từ 1 đến 10.000.';
  if (
    step === 3 &&
    new Set(draft.commonAssets.map((asset) => commonAssetKey(asset.name))).size !==
      draft.commonAssets.length
  )
    return 'Tài sản chung đã có trong cơ sở. Hãy chỉnh số lượng ở mục đã chọn thay vì thêm trùng.';
  if (step === 4) {
    if (draft.fees.some((fee) => fee.requiresRoom && !fee.roomKey))
      return 'Biểu phí riêng của phòng nguồn cần chọn phòng đích hoặc bỏ khoản phí.';
    if (
      draft.fees.some(
        (fee) =>
          !fee.name.trim() ||
          !/^[A-Z0-9_-]{1,80}$/.test(fee.chargeCode) ||
          String(fee.rate).trim() === '' ||
          !/^\d{1,14}(?:\.\d{1,4})?$/.test(String(fee.rate)) ||
          !fee.effectiveFrom ||
          fee.effectiveFrom < today() ||
          (!!fee.effectiveTo && fee.effectiveTo < fee.effectiveFrom) ||
          (fee.roomKey !== null && !draft.rooms.some((room) => room.key === fee.roomKey)) ||
          (fee.category === 0 && fee.roomKey !== null) ||
          (fee.category === 1 && (fee.method !== 1 || fee.chargeCode !== 'ELECTRICITY')) ||
          (fee.category === 2 && (fee.method !== 1 || fee.chargeCode !== 'WATER')) ||
          (fee.category === 3 &&
            (![0, 2].includes(fee.method) ||
              ['RENT', 'ELECTRICITY', 'WATER'].includes(fee.chargeCode))),
      )
    )
      return 'Kiểm tra tên, mã khoản thu, phương thức, ngày hiệu lực và phạm vi từng biểu phí.';
    if (draft.fees.some((a, i) => draft.fees.slice(i + 1).some((b) => feeOverlaps(a, b))))
      return 'Có biểu phí trùng mã và khoảng hiệu lực trong cùng phạm vi.';
  }
  if (step === 5 && draft.rules.length) {
    if (
      !draft.policyTitle.trim() ||
      !draft.policyDate ||
      draft.rules.some((rule) => !rule.title.trim() || !rule.content.trim()) ||
      draft.rules.map((rule) => `${rule.title}\n${rule.content}`).join('\n\n').length > 12000
    )
      return 'Nội quy cần tiêu đề, nội dung, ngày hiệu lực; tổng nội dung tối đa 12.000 ký tự.';
  }
  return null;
}

export function toLocationSetupInput(draft: Draft): LocationSetupInput {
  const references = uniqueReferences([
    ...draft.roomTypes.flatMap((type) => [
      ...(type.sourceId &&
      type.sourceVersion &&
      (type.sourceKind === 'SharedTemplate' || type.sourceKind === 'RoomDefaults')
        ? [
            reference(
              type.sourceKind === 'SharedTemplate' ? 'room-type-templates' : 'RoomDefaults',
              { id: type.sourceId, version: type.sourceVersion },
            ),
          ]
        : []),
      ...type.assets.flatMap((asset) => asset.references ?? []),
    ]),
    ...draft.fees.flatMap((fee) => (fee.reference ? [fee.reference] : [])),
    ...draft.commonAssets.flatMap((asset) => asset.references ?? []),
    ...draft.rules.flatMap((rule) => (rule.reference ? [rule.reference] : [])),
  ]);
  return {
    location: {
      ...draft.location,
      name: draft.location.name.trim(),
      address: draft.location.address.trim(),
      code: suggestedLocationCode(draft.location.name),
      contactPhone: normalizeContactPhone(draft.location.contactPhone) ?? '',
      contactEmail: draft.location.contactEmail.trim(),
      description: draft.location.description.trim(),
    },
    roomTypes: draft.roomTypes.map((type) => ({
      key: type.key,
      name: type.name.trim(),
      description: type.description.trim(),
      capacity: type.capacity,
      area: type.area,
      referenceRent: type.referenceRent,
      amenities: [...new Set(type.amenities.map((value) => value.trim()).filter(Boolean))],
      assets: type.assets.map((asset) => ({
        name: asset.name.trim(),
        category: asset.category.trim(),
        quantity: asset.quantity,
        trackingMode: asset.trackingMode,
        unit: asset.unit ?? null,
        ...(asset.referencePrice == null ? {} : { referencePrice: asset.referencePrice }),
      })),
      sourceId: type.sourceId,
      sourceVersion: type.sourceVersion,
      sourceKind: type.sourceKind,
    })),
    rooms: draft.rooms.map((room) => ({
      ...room,
      roomNumber: room.roomNumber.trim(),
      rent:
        room.rent ?? draft.roomTypes.find((type) => type.key === room.roomTypeKey)!.referenceRent!,
    })),
    ...(draft.commonAssets.length
      ? {
          commonAssets: draft.commonAssets.map((asset) => ({
            id: asset.id,
            name: asset.name.trim(),
            category: asset.category.trim(),
            commonArea: asset.commonArea.trim(),
            quantity: asset.quantity,
            trackingMode: asset.trackingMode,
            unit: asset.unit ?? null,
            ...(asset.referencePrice == null ? {} : { referencePrice: asset.referencePrice }),
          })),
        }
      : {}),
    fees: draft.fees.map((fee) => ({
      roomKey: fee.roomKey,
      category: fee.category,
      chargeCode: fee.chargeCode.trim().toUpperCase(),
      name: fee.name.trim(),
      method: fee.method,
      rate: fee.rate,
      effectiveFrom: fee.effectiveFrom,
      effectiveTo: fee.effectiveTo,
    })),
    policy: draft.rules.length
      ? {
          title: draft.policyTitle.trim(),
          content: draft.rules
            .map((rule) => `${rule.title.trim()}\n${rule.content.trim()}`)
            .join('\n\n'),
          effectiveFrom: draft.policyDate,
        }
      : null,
    activate: draft.activate,
    rentEffectiveFrom: draft.rentEffectiveFrom,
    sourceLocationId: draft.appliedSource,
    sourceState: draft.sourceState,
    ...(references.length ? { sourceReferences: references } : {}),
  };
}
