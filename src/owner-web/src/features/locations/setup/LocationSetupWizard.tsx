import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Step,
  StepButton,
  Stepper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  CheckCircle2,
  ChevronDown,
  Copy,
  Package,
  Plus,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import { ASSET_UNITS } from '../../../../../../packages/client-core/src/assetUnits';
import {
  contactPhoneError,
  normalizeContactPhone,
} from '../../../../../../packages/client-core/src/contactPhone';
import {
  locationSetupClient,
  type LocationSetupInput,
  type LocationSetupInformation,
  type LocationSetupResult,
  type SetupAssetRequirement,
  type SetupCommonAssetRequirement,
  type SetupFee,
  type SetupRoomDefaults,
  type LocationSetupSource,
  type SetupSourceReference,
} from '../../../../../../packages/client-core/src/locationSetup';
import { assetCatalogSupportsScope } from '../../../../../../packages/client-core/src/sharedConfiguration';
import type {
  AssetCatalogData,
  FeeTemplateData,
  PolicyTemplateData,
  RoomTemplateData,
  SharedDocument,
  SharedResource,
  SharedWrite,
} from '../../../../../../packages/client-core/src/sharedConfiguration';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
import { useSharedConfigurationApi } from '../../configuration/useSharedConfigurationApi';
import { SharedTemplateEditor } from '../../configuration/pages/SharedTemplateEditor';
import { todayVietnam } from '../../staff/staffContracts';
import type { PortalRecord } from '../../../types/portal';
import { SetupDropZone, SetupTemplatePicker } from './SetupTemplatePicker';
import { MoneyField } from '../../../components/common/MoneyField';
import { SetupBillingPreview } from './SetupBillingPreview';
import {
  formatBillingDecimal,
  invoiceError,
} from '../../../../../../packages/client-core/src/invoices';
import { ApiError } from '../../../../../../packages/client-core/src/api';
import { suggestedLocationCode } from './locationCode';

const steps = [
  'Thông tin cơ sở',
  'Loại phòng',
  'Sinh phòng hàng loạt',
  'Tài sản & tiện nghi',
  'Giá & biểu phí',
  'Nội quy',
  'Xem lại & hoàn tất',
];
// Keep the persisted draft step IDs stable for existing users while moving
// asset requirements ahead of room generation in the visible workflow.
const stepOrder = [0, 1, 3, 2, 4, 5, 6] as const;
const stepPosition = (step: number) => stepOrder.indexOf(step as (typeof stepOrder)[number]);
const libraryKinds: SharedResource[] = [
  'room-type-templates',
  'asset-catalog',
  'fee-templates',
  'policy-templates',
];
const money = (value: number | string | null) =>
  value === null ? 'Chưa đặt' : formatBillingDecimal(value) + ' đ';
const norm = (value: string) => value.trim().toLocaleLowerCase();
// Match catalog items also when a copied legacy requirement has no catalog reference.
// Accents/case/spacing must not let an item be added twice to one location.
const commonAssetKey = (value: string) =>
  value
    .trim()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/gi, 'd')
    .toLocaleLowerCase('vi')
    .replace(/\s+/g, ' ');
const uid = () => crypto.randomUUID();
const today = () => todayVietnam();
const validMoney = (value: number | string | null): boolean =>
  value !== null && /^\d{1,14}(?:\.\d{1,4})?$/.test(String(value));
const feeOverlaps = (
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
const exactRent = (value: string | number): string | number =>
  /^\d{1,14}$/.test(String(value)) ? Number(value) : value;
const categories = ['Tiền thuê', 'Điện', 'Nước', 'Dịch vụ'];
type DraftRoom = {
  key: string;
  roomNumber: string;
  floor: string;
  roomTypeKey: string;
  rent: number | string | null;
};
type DraftAsset = SetupAssetRequirement & { references?: SetupSourceReference[] };
type DraftCommonAsset = SetupCommonAssetRequirement & {
  references?: SetupSourceReference[];
  sourceItemId?: string;
};
type DraftType = Omit<SetupRoomDefaults, 'assets'> & {
  assets: DraftAsset[];
  assetTemplateSourceName?: string;
  assetTemplateSourceVersion?: number;
};
type DraftFee = Omit<SetupFee, 'rate'> & {
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
type Draft = {
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
const reference = (
  kind: SetupSourceReference['kind'],
  doc: { id: string; version: number },
): SetupSourceReference => ({ id: doc.id, version: doc.version, kind });
const uniqueReferences = (references: SetupSourceReference[]) => [
  ...new Map(references.map((item) => [`${item.kind}:${item.id}:${item.version}`, item])).values(),
];

type SameFamily = (id: string | null | undefined, doc: SharedDocument) => boolean;
const sameDocument: SameFamily = (id, doc) => id === doc.id;
const latestDocuments = (documents: SharedDocument[], status: SharedDocument['status']) => {
  const latest = new Map<string, SharedDocument>();
  for (const doc of documents) {
    if (doc.status !== status) continue;
    const previous = latest.get(doc.familyId);
    if (!previous || previous.edition < doc.edition) latest.set(doc.familyId, doc);
  }
  return [...latest.values()];
};

const matchesCatalog = (asset: DraftAsset, doc: SharedDocument, sameFamily = sameDocument) =>
  asset.references?.some((item) => item.kind === 'asset-catalog' && sameFamily(item.id, doc)) ||
  norm(asset.name) === norm(doc.name);
const matchesCommonCatalog = (
  asset: DraftCommonAsset,
  doc: SharedDocument,
  sameFamily = sameDocument,
) =>
  asset.references?.some((item) => item.kind === 'asset-catalog' && sameFamily(item.id, doc)) ||
  commonAssetKey(asset.name) === commonAssetKey(doc.name);

const matchesRoomTemplate = (type: DraftType, doc: SharedDocument, sameFamily = sameDocument) =>
  sameFamily(type.sourceId, doc) || norm(type.name) === norm(doc.name);

const matchesFeeTemplate = (fee: DraftFee, doc: SharedDocument, sameFamily = sameDocument) => {
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

function mergeCatalogAssets(
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

const newType = (): DraftType => ({
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
const newDraft = (source?: string): Draft => ({
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
const categoryNumber = (value: string | number): SetupFee['category'] => {
  if (typeof value === 'number' && value >= 0 && value <= 3) return value as SetupFee['category'];
  const index = ['RENT', 'ELECTRICITY', 'WATER', 'SERVICEFEE'].indexOf(
    String(value).replace(/_/g, '').toUpperCase(),
  );
  return index < 0 ? 3 : (index as SetupFee['category']);
};
const methodNumber = (value: string | number): SetupFee['method'] =>
  value === 1 || String(value).toUpperCase() === 'METERED'
    ? 1
    : value === 2 || String(value).toUpperCase() === 'FIXEDPERPERSONPERMONTH'
      ? 2
      : 0;
const feeUnitLabel = (category: SetupFee['category'], method: SetupFee['method']) =>
  method === 2 ? 'người/tháng' : method === 1 ? (category === 2 ? 'm³' : 'kWh') : 'phòng/tháng';
const dateLabel = (value: string) => value.split('-').reverse().join('/');
const feeDate = (value: string) => (value >= today() ? value : today());
const sourceType = (document: SharedDocument): DraftType => {
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

function validateSetupStep(draft: Draft, step: number): string | null {
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

function toLocationSetupInput(draft: Draft): LocationSetupInput {
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

export function LocationSetupWizard({
  locations,
  initialSource,
  onClose,
  onComplete,
}: {
  locations: Pick<PortalRecord, 'id' | 'name'>[];
  initialSource?: string;
  onClose: () => void;
  onComplete: (result: LocationSetupResult) => void | Promise<void>;
}) {
  const { session } = useAuth();
  const owner = session?.roles.includes('Owner') ?? false;
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down('lg'));
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));
  const storageKey = `bhome-location-setup-v2:${session?.userId ?? 'owner'}`;
  const property = usePropertySetupApi();
  const shared = useSharedConfigurationApi();
  const queryClient = useQueryClient();
  const libraryKey = ['property-setup', 'location-setup-library', session?.userId] as const;
  const api = useMemo(() => locationSetupClient(property.request), [property.request]);
  const [draft, setDraft] = useState<Draft>(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const restored = JSON.parse(raw) as Draft;
        if (
          restored.key &&
          restored.location &&
          Array.isArray(restored.roomTypes) &&
          Array.isArray(restored.rooms) &&
          (!initialSource || restored.sourceLocationId === initialSource)
        )
          return { ...newDraft(initialSource), ...restored };
      }
    } catch {
      /* old draft unavailable */
    }
    return newDraft(initialSource);
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const generationLock = useRef(false);
  const [draftSaved, setDraftSaved] = useState(true);
  const [editingRoomKey, setEditingRoomKey] = useState<string | null>(null);
  const [confirmClearRooms, setConfirmClearRooms] = useState(false);
  const lock = useRef(false);
  const committed = useRef(false);
  const [copySelection, setCopySelection] = useState<string[]>([]);
  const [floor, setFloor] = useState('1');
  const [typeKey, setTypeKey] = useState('');
  const [prefix, setPrefix] = useState('P.');
  const [quantity, setQuantity] = useState('4');
  const [assetTypeKey, setAssetTypeKey] = useState('');
  const [assetScope, setAssetScope] = useState<'Room' | 'Location'>('Room');
  const [confirmSave, setConfirmSave] = useState(false);
  const [editingType, setEditingType] = useState<DraftType | null>(null);
  const [editingFeeKey, setEditingFeeKey] = useState('');
  const [editingRuleKey, setEditingRuleKey] = useState('');
  const [libraryEditor, setLibraryEditor] = useState<{
    resource: SharedResource;
    document: SharedDocument | null;
  } | null>(null);
  const [librarySaving, setLibrarySaving] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const librarySaveLock = useRef(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const billingPreviewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [draft.step, error]);

  const patch = (change: Partial<Draft>) => {
    setDraft((previous) => ({ ...previous, ...change }));
    setError('');
    setConfirmSave(false);
  };
  const info = (change: Partial<LocationSetupInformation>) => {
    setDraft((previous) => {
      const updated = { ...previous.location, ...change };
      if (change.name !== undefined) updated.code = suggestedLocationCode(change.name);
      return { ...previous, location: updated };
    });
    setError('');
    setConfirmSave(false);
  };
  useEffect(() => {
    try {
      if (owner && !committed.current) {
        sessionStorage.setItem(storageKey, JSON.stringify(draft));
        window.queueMicrotask(() => setDraftSaved(true));
      }
    } catch {
      window.queueMicrotask(() => setDraftSaved(false));
    }
  }, [draft, owner, storageKey]);

  const library = useQuery({
    queryKey: libraryKey,
    queryFn: async ({ signal }) => {
      const result = await Promise.allSettled(
        libraryKinds.map(async (resource) => {
          const items: SharedDocument[] = [];
          for (let page = 1; ; page += 1) {
            const data = await shared.list(resource, '', '', page, 100, signal);
            items.push(...data.items);
            if (items.length >= data.total) break;
            if (!data.items.length) throw new Error('Danh sách mẫu thay đổi khi tải.');
          }
          return [resource, items] as const;
        }),
      );
      return {
        items: Object.fromEntries(
          result.flatMap((item) => (item.status === 'fulfilled' ? [item.value] : [])),
        ) as Partial<Record<SharedResource, SharedDocument[]>>,
        failures: libraryKinds.filter((_, index) => result[index].status === 'rejected'),
      };
    },
    staleTime: 0,
    enabled: owner,
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });
  const source = useQuery({
    queryKey: ['location-setup-source', session?.userId, draft.sourceLocationId],
    queryFn: ({ signal }) => api.source(draft.sourceLocationId, signal),
    enabled: owner && draft.mode === 'copy' && !!draft.sourceLocationId,
  });
  const all = (resource: SharedResource) =>
    latestDocuments(library.data?.items[resource] ?? [], 'Published');
  const sameFamily: SameFamily = (id, doc) =>
    id === doc.id ||
    (library.data?.items[doc.resource] ?? []).some(
      (item) => item.id === id && item.familyId === doc.familyId,
    );
  const librarySection: { resource: SharedResource; label: string } | null =
    draft.step === 1
      ? { resource: 'room-type-templates', label: 'Thêm loại phòng mẫu' }
      : draft.step === 3
        ? { resource: 'asset-catalog', label: 'Thêm loại tài sản mới' }
        : draft.step === 4
          ? { resource: 'fee-templates', label: 'Thêm mẫu biểu phí' }
          : draft.step === 5
            ? { resource: 'policy-templates', label: 'Thêm mẫu nội quy' }
            : null;
  const openLibraryEditor = (resource: SharedResource, document: SharedDocument | null = null) => {
    setLibraryError('');
    setLibraryEditor({ resource, document });
  };
  const rememberLibraryDocument = async (document: SharedDocument) => {
    await queryClient.cancelQueries({ queryKey: libraryKey, exact: true });
    queryClient.setQueryData<NonNullable<typeof library.data>>(libraryKey, (previous) => ({
      items: {
        ...previous?.items,
        [document.resource]: [
          ...(previous?.items[document.resource] ?? []).filter(
            (item) =>
              item.id !== document.id &&
              !(item.status === 'Draft' && item.familyId === document.familyId),
          ),
          document,
        ],
      },
      failures: previous?.failures ?? [],
    }));
    void queryClient.invalidateQueries({
      queryKey: ['property-setup', 'shared', session?.userId, document.resource],
    });
    if (document.resource === 'asset-catalog')
      void queryClient.invalidateQueries({
        queryKey: ['property-setup', 'shared-catalog-picker', session?.userId],
      });
  };
  const saveLibraryTemplate = async (input: SharedWrite) => {
    if (!owner || !libraryEditor || librarySaveLock.current) return;
    librarySaveLock.current = true;
    setLibrarySaving(true);
    setLibraryError('');
    const { resource, document } = libraryEditor;
    try {
      const published = await shared.save(resource, document?.id ?? null, {
        ...input,
        expectedVersion: document?.version ?? 0,
        publishImmediately: true,
      });
      await rememberLibraryDocument(published);
      setLibraryEditor(null);
      setNotice(`${published.name} đã có thể áp dụng vào cơ sở.`);
    } catch (failure) {
      setLibraryError(invoiceError(failure));
      void library.refetch();
    } finally {
      librarySaveLock.current = false;
      setLibrarySaving(false);
    }
  };
  const libraryActions = librarySection ? (
    <Stack spacing={0.5}>
      <Button
        size="small"
        variant="outlined"
        startIcon={<Plus size={16} />}
        disabled={librarySaving || library.isPending}
        onClick={() => openLibraryEditor(librarySection.resource)}
        sx={{ alignSelf: 'flex-start', minHeight: { xs: 44, sm: 36 } }}
      >
        {librarySection.label}
      </Button>
      {library.isFetching && <LinearProgress aria-label="Đang tải thư viện mẫu" />}
      {!library.isFetching &&
        latestDocuments(library.data?.items[librarySection.resource] ?? [], 'Draft')
          .filter(
            (doc) =>
              doc.status === 'Draft' &&
              (doc.resource !== 'asset-catalog' ||
                assetCatalogSupportsScope(doc.data as AssetCatalogData, assetScope)) &&
              (doc.resource !== 'fee-templates' ||
                categoryNumber((doc.data as FeeTemplateData).category) !== 0),
          )
          .map((doc) => (
            <Stack key={doc.id} direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
              <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
                {doc.name} · Bản nháp, chưa cho phép áp dụng
              </Typography>
              <Button size="small" onClick={() => openLibraryEditor(doc.resource, doc)}>
                Tiếp tục
              </Button>
            </Stack>
          ))}
    </Stack>
  ) : null;
  const currentType = draft.roomTypes.find((type) => type.key === typeKey) ?? draft.roomTypes[0];
  const assetType = draft.roomTypes.find((type) => type.key === assetTypeKey) ?? draft.roomTypes[0];
  const updateType = (key: string, change: Partial<DraftType>) =>
    setDraft((previous) => ({
      ...previous,
      roomTypes: previous.roomTypes.map((type) =>
        type.key === key ? { ...type, ...change } : type,
      ),
    }));
  const updateRoom = (key: string, change: Partial<DraftRoom>) =>
    setDraft((previous) => ({
      ...previous,
      rooms: previous.rooms.map((room) => (room.key === key ? { ...room, ...change } : room)),
    }));
  const removeRoom = (key: string) => {
    setDraft((previous) => ({
      ...previous,
      rooms: previous.rooms.filter((room) => room.key !== key),
      fees: previous.fees.map((fee) => (fee.roomKey === key ? { ...fee, roomKey: '' } : fee)),
    }));
    setEditingRoomKey(null);
    setError('');
  };
  const clearRooms = () => {
    setDraft((previous) => ({
      ...previous,
      rooms: [],
      fees: previous.fees.map((fee) => (fee.roomKey ? { ...fee, roomKey: '' } : fee)),
    }));
    setConfirmClearRooms(false);
    setError('');
    setNotice('Đã xóa tất cả phòng trong bản nháp. Không ảnh hưởng dữ liệu đã lưu.');
  };
  const updateFee = (key: string, change: Partial<DraftFee>) =>
    setDraft((previous) => ({
      ...previous,
      fees: previous.fees.map((fee) => (fee.key === key ? { ...fee, ...change } : fee)),
    }));
  const changeStep = (next: number) => {
    if (busy || generating) return;
    if (next !== draft.step) setNotice('');
    if (stepPosition(next) > stepPosition(draft.step))
      for (let i = 0; i < stepPosition(next); i++) {
        const step = stepOrder[i];
        const problem = validateSetupStep(draft, step);
        if (problem) {
          setError(problem);
          setDraft((previous) => ({ ...previous, step }));
          return;
        }
      }
    patch({ step: next });
  };
  const addType = (id: string) => {
    const template = all('room-type-templates').find((item) => item.id === id);
    if (!template) return;
    if (draft.roomTypes.some((type) => matchesRoomTemplate(type, template, sameFamily))) {
      setError('Loại phòng này đã có trong cấu hình cơ sở.');
      return;
    }
    const type = sourceType(template);
    setDraft((previous) => ({ ...previous, roomTypes: [...previous.roomTypes, type] }));
    setNotice(`Đã nạp ${type.name} thành bản cấu hình độc lập.`);
    setError('');
  };
  const saveType = () => {
    if (!editingType) return;
    if (
      editingType.name.trim().length < 2 ||
      !Number.isInteger(editingType.capacity) ||
      editingType.capacity < 1 ||
      editingType.capacity > 32767 ||
      !Number.isFinite(editingType.area) ||
      editingType.area <= 0
    ) {
      setError('Nhập tên, diện tích và sức chứa hợp lệ.');
      return;
    }
    if (
      draft.roomTypes.some(
        (type) => type.key !== editingType.key && norm(type.name) === norm(editingType.name),
      )
    ) {
      setError('Tên loại phòng đã tồn tại.');
      return;
    }
    const exists = draft.roomTypes.some((type) => type.key === editingType.key);
    setDraft((previous) => ({
      ...previous,
      roomTypes: exists
        ? previous.roomTypes.map((type) => (type.key === editingType.key ? editingType : type))
        : [...previous.roomTypes, editingType],
    }));
    setEditingType(null);
    setError('');
  };
  const removeType = (key: string) => {
    if (draft.rooms.some((room) => room.roomTypeKey === key)) {
      setError('Hãy chuyển hoặc xóa các phòng đang sử dụng loại phòng này trước.');
      return;
    }
    patch({ roomTypes: draft.roomTypes.filter((type) => type.key !== key) });
  };
  const generate = () => {
    if (generationLock.current) return;
    const count = Number(quantity),
      level = Number(floor);
    if (
      !currentType ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > 200 ||
      !Number.isInteger(level) ||
      level < 1 ||
      level > draft.location.floors ||
      !prefix.trim()
    ) {
      setError('Chọn loại phòng, tầng, tiền tố và số lượng từ 1–200.');
      return;
    }
    if (draft.rooms.length + count > 200) {
      setError('Một lần thiết lập hỗ trợ tối đa 200 phòng.');
      return;
    }
    generationLock.current = true;
    setGenerating(true);
    // Allow the busy indicator to paint before building the room matrix.
    window.setTimeout(() => {
      const existing = new Set(draft.rooms.map((room) => norm(room.roomNumber)));
      let sequence = level * 100 + 1;
      const rows: DraftRoom[] = [];
      while (rows.length < count) {
        const roomNumber = `${prefix}${sequence++}`;
        if (existing.has(norm(roomNumber))) continue;
        existing.add(norm(roomNumber));
        rows.push({
          key: uid(),
          roomNumber,
          floor: String(level),
          roomTypeKey: currentType.key,
          rent: null,
        });
      }
      patch({ rooms: [...draft.rooms, ...rows] });
      setNotice(`Đã sinh ${rows.length} phòng nháp từ ${currentType.name}.`);
      generationLock.current = false;
      setGenerating(false);
    }, 120);
  };
  const catalogAssets = all('asset-catalog').filter((doc) =>
    assetCatalogSupportsScope(doc.data as AssetCatalogData, 'Room'),
  );
  const commonCatalog = all('asset-catalog').filter((doc) =>
    assetCatalogSupportsScope(doc.data as AssetCatalogData, 'Location'),
  );
  const selectedCommonCatalogIds = commonCatalog
    .filter((doc) =>
      draft.commonAssets.some((asset) => matchesCommonCatalog(asset, doc, sameFamily)),
    )
    .map((doc) => doc.id);
  const addCommonAsset = (id: string) => {
    const doc = commonCatalog.find((item) => item.id === id);
    if (!doc) return;
    if (draft.commonAssets.some((asset) => matchesCommonCatalog(asset, doc, sameFamily))) {
      setNotice(
        `${doc.name} đã có trong tài sản chung. Bạn có thể chỉnh số lượng ở danh sách bên phải.`,
      );
      return;
    }
    const data = doc.data as AssetCatalogData;
    setDraft((previous) => {
      if (previous.commonAssets.some((asset) => matchesCommonCatalog(asset, doc, sameFamily)))
        return previous;
      return {
        ...previous,
        commonAssets: [
          ...previous.commonAssets,
          {
            id: uid(),
            name: doc.name,
            category: data.category,
            unit: data.unit,
            referencePrice: data.referencePrice,
            quantity: 1,
            trackingMode: 'BulkQuantity',
            commonArea: '',
            references: [reference('asset-catalog', doc)],
          },
        ],
      };
    });
    setError('');
    setConfirmSave(false);
  };
  const updateCommonAsset = (id: string, change: Partial<DraftCommonAsset>) =>
    setDraft((previous) => ({
      ...previous,
      commonAssets: previous.commonAssets.map((asset) =>
        asset.id === id ? { ...asset, ...change } : asset,
      ),
    }));
  const addCatalogAssets = (documents: SharedDocument[]) => {
    if (!assetType) return;
    setDraft((previous) => ({
      ...previous,
      roomTypes: previous.roomTypes.map((type) =>
        type.key === assetType.key
          ? { ...type, assets: mergeCatalogAssets(type.assets, documents, sameFamily) }
          : type,
      ),
    }));
    setError('');
    setConfirmSave(false);
  };
  const addAsset = (id: string) => {
    const item = catalogAssets.find((document) => document.id === id);
    if (item) addCatalogAssets([item]);
  };
  const selectedCatalogIds = catalogAssets
    .filter((doc) => assetType?.assets.some((asset) => matchesCatalog(asset, doc, sameFamily)))
    .map((doc) => doc.id);
  const remainingCatalog = catalogAssets.filter((doc) => !selectedCatalogIds.includes(doc.id));
  const editingRoom = draft.rooms.find((room) => room.key === editingRoomKey);
  const editingRoomType = draft.roomTypes.find((type) => type.key === editingRoom?.roomTypeKey);
  const newFee = (): DraftFee => ({
    key: uid(),
    roomKey: null,
    category: 3,
    chargeCode: '',
    name: '',
    method: 0,
    rate: 0,
    effectiveFrom: today(),
    effectiveTo: null,
  });
  const addFee = (id: string) => {
    const item = all('fee-templates').find((document) => document.id === id);
    if (!item) return;
    const data = item.data as FeeTemplateData;
    const category = categoryNumber(data.category);
    if (category === 0) {
      setError('Giá thuê được thiết lập một lần theo từng loại phòng ở bảng bên cạnh.');
      return;
    }
    const candidate: DraftFee = {
      ...newFee(),
      sourceId: id,
      reference: reference('fee-templates', item),
      category,
      name: item.name,
      chargeCode: data.chargeCode.toUpperCase(),
      method: methodNumber(data.method),
      rate: data.referenceRate,
      roomKey: data.scope === 'Room' ? '' : null,
      requiresRoom: data.scope === 'Room',
      effectiveFrom: feeDate(data.effectiveFrom),
      effectiveTo: data.effectiveTo && data.effectiveTo >= today() ? data.effectiveTo : null,
    };
    if (draft.fees.some((fee) => matchesFeeTemplate(fee, item, sameFamily))) {
      setError('Khoản phí cùng mã và thời gian hiệu lực đã có trong cấu hình.');
      return;
    }
    patch({ fees: [...draft.fees, candidate] });
  };
  const addRule = (id: string) => {
    const item = all('policy-templates').find((document) => document.id === id);
    if (!item || draft.rules.some((rule) => sameFamily(rule.sourceId, item))) return;
    const data = item.data as PolicyTemplateData;
    patch({
      rules: [
        ...draft.rules,
        {
          key: uid(),
          title: item.name,
          content: data.content,
          sourceId: id,
          reference: reference('policy-templates', item),
        },
      ],
    });
  };

  const copyGroups = (data: LocationSetupSource) => [
    {
      label: 'Loại phòng và tài sản đi kèm',
      kind: 'type',
      items: data.roomTypes
        .filter((doc) => doc.status !== 'Archived')
        .map((doc) => {
          const linked = data.assetTemplates.find(
            (template) =>
              template.id === doc.data.assetTemplateId && template.status === 'Published',
          );
          return {
            id: doc.id,
            name: doc.data.name,
            detail: `${doc.data.defaults.capacity} người · ${doc.data.defaults.area ?? 'Chưa khai báo'} m² · ${linked ? `${linked.data.items.length} loại tài sản đi kèm` : 'Chưa gắn mẫu tài sản'}`,
          };
        }),
    },
    ...(data.commonAssets?.data.items.length
      ? [
          {
            label: 'Tài sản chung cơ sở',
            kind: 'common',
            items: [
              {
                id: data.commonAssets.id,
                name: 'Tài sản chung cơ sở nguồn',
                detail: `${data.commonAssets.data.items.length} mục theo khu vực`,
              },
            ],
          },
        ]
      : []),
    {
      label: 'Biểu phí dịch vụ',
      kind: 'fee',
      items: data.fees
        .filter(
          (fee) =>
            categoryNumber(fee.category) !== 0 &&
            fee.effectiveFrom <= today() &&
            (!fee.effectiveTo || fee.effectiveTo >= today()),
        )
        .map((fee) => ({
          id: fee.id,
          name: fee.name,
          detail: `${money(fee.rate)}/${feeUnitLabel(categoryNumber(fee.category), methodNumber(fee.method))} · ${fee.roomId ? 'Cần ánh xạ phòng đích' : 'Cấp cơ sở'}`,
        })),
    },
    {
      label: 'Nội quy',
      kind: 'rule',
      items: data.policies
        .filter((doc) => doc.status === 'Published' || doc.status === 'Draft')
        .map((doc) => ({
          id: doc.id,
          name: doc.data.title,
          detail: `${doc.status === 'Published' ? 'Có thể áp dụng' : 'Bản nháp'} · ${doc.data.effectiveFrom}`,
        })),
    },
  ];
  const applyCopy = () => {
    if (!source.data || !copySelection.length) {
      setError('Chọn ít nhất một cấu hình nguồn.');
      return;
    }
    if (draft.appliedSource && draft.appliedSource !== draft.sourceLocationId) {
      setError('Bản nháp đã nạp nguồn khác. Hãy tạo bản nháp mới để đổi cơ sở nguồn.');
      return;
    }
    const data = source.data;
    const availableSelections = new Set(
      copyGroups(data).flatMap((group) => group.items.map((item) => `${group.kind}:${item.id}`)),
    );
    if (copySelection.some((item) => !availableSelections.has(item))) {
      setCopySelection((previous) => previous.filter((item) => availableSelections.has(item)));
      setError(
        'Một số cấu hình nguồn không còn khả dụng. Kiểm tra lại các mục đã chọn trước khi nạp.',
      );
      return;
    }
    if (draft.appliedSource && draft.sourceState !== data.sourceState) {
      setError('Cấu hình nguồn đã thay đổi. Tạo bản nháp mới để nạp phiên bản mới nhất.');
      return;
    }
    const selected = (kind: string, id: string) => copySelection.includes(`${kind}:${id}`);
    const selectedTypes = data.roomTypes.filter((doc) => selected('type', doc.id));
    const missingLinkedTemplate = selectedTypes.find(
      (doc) =>
        doc.data.assetTemplateId &&
        !data.assetTemplates.some(
          (template) => template.id === doc.data.assetTemplateId && template.status === 'Published',
        ),
    );
    if (missingLinkedTemplate) {
      setError(
        `Loại phòng ${missingLinkedTemplate.data.name} đang tham chiếu đến mẫu tài sản đã ngừng áp dụng. Hãy cập nhật cấu hình nguồn trước khi sao chép.`,
      );
      return;
    }
    const newTypes = selectedTypes
      .filter(
        (doc) =>
          !draft.roomTypes.some(
            (type) => type.sourceId === doc.id || norm(type.name) === norm(doc.data.name),
          ),
      )
      .map((doc) => {
        const linked = data.assetTemplates.find(
          (template) => template.id === doc.data.assetTemplateId && template.status === 'Published',
        );
        const assetReference = linked ? reference('AssetTemplate', linked) : null;
        return {
          ...newType(),
          name: doc.data.name,
          description: doc.data.description ?? '',
          capacity: doc.data.defaults.capacity,
          area: Number(doc.data.defaults.area),
          referenceRent:
            doc.data.defaults.referenceRent === null
              ? null
              : exactRent(doc.data.defaults.referenceRent),
          amenities: [...doc.data.defaults.amenities],
          assets:
            linked?.data.items.map((item) => ({
              name: item.name,
              category: item.category,
              quantity: item.quantity,
              trackingMode: item.trackingMode,
              unit: item.unit ?? null,
              referencePrice: item.referencePrice ?? null,
              references: assetReference ? [assetReference] : [],
            })) ?? [],
          assetTemplateSourceName: linked?.data.name,
          assetTemplateSourceVersion: linked?.version,
          sourceId: doc.id,
          sourceVersion: doc.version,
          sourceKind: 'RoomDefaults' as const,
        };
      });
    const feeCandidates = data.fees
      .filter(
        (fee) =>
          selected('fee', fee.id) &&
          categoryNumber(fee.category) !== 0 &&
          fee.effectiveFrom <= today() &&
          (!fee.effectiveTo || fee.effectiveTo >= today()),
      )
      .map((fee) => ({
        ...newFee(),
        sourceId: fee.id,
        reference: reference('BillingPolicy', fee),
        category: categoryNumber(fee.category),
        name: fee.name,
        chargeCode: fee.chargeCode,
        method: methodNumber(fee.method),
        rate: fee.rate,
        roomKey: fee.roomId ? '' : null,
        requiresRoom: !!fee.roomId,
        sourceRoomId: fee.roomId ?? undefined,
        effectiveFrom: today(),
        effectiveTo: fee.effectiveTo && fee.effectiveTo >= today() ? fee.effectiveTo : null,
      }));
    const newFees: DraftFee[] = [];
    for (const candidate of feeCandidates) {
      const duplicate = [...draft.fees, ...newFees].some(
        (existing) =>
          existing.sourceId === candidate.sourceId ||
          (!candidate.requiresRoom && !existing.requiresRoom && feeOverlaps(existing, candidate)) ||
          (!!candidate.requiresRoom &&
            !!existing.requiresRoom &&
            existing.sourceRoomId === candidate.sourceRoomId &&
            existing.chargeCode.trim().toUpperCase() ===
              candidate.chargeCode.trim().toUpperCase() &&
            existing.effectiveFrom <= (candidate.effectiveTo ?? '9999-12-31') &&
            candidate.effectiveFrom <= (existing.effectiveTo ?? '9999-12-31')),
      );
      if (!duplicate) newFees.push(candidate);
    }
    const newRules = data.policies
      .filter(
        (doc) => selected('rule', doc.id) && !draft.rules.some((rule) => rule.sourceId === doc.id),
      )
      .map((doc) => ({
        key: uid(),
        title: doc.data.title,
        content: doc.data.content,
        sourceId: doc.id,
        reference: reference('OperatingPolicy', doc),
      }));
    const sourceCommon = data.commonAssets;
    const newCommon =
      sourceCommon && selected('common', sourceCommon.id)
        ? sourceCommon.data.items
            .filter(
              (asset, index, items) =>
                !draft.commonAssets.some(
                  (existing) =>
                    existing.sourceItemId === asset.id ||
                    commonAssetKey(existing.name) === commonAssetKey(asset.name),
                ) &&
                items.findIndex(
                  (item) => commonAssetKey(item.name) === commonAssetKey(asset.name),
                ) === index,
            )
            .map((asset) => ({
              ...asset,
              id: uid(),
              sourceItemId: asset.id,
              references: [reference('CommonAssetRequirements', sourceCommon)],
            }))
        : [];
    patch({
      appliedSource: draft.sourceLocationId,
      sourceState: data.sourceState,
      roomTypes: [...draft.roomTypes, ...newTypes],
      commonAssets: [...draft.commonAssets, ...newCommon],
      fees: [...draft.fees, ...newFees],
      rules: [...draft.rules, ...newRules],
    });
    const copiedAssets = newTypes.reduce((total, type) => total + type.assets.length, 0);
    setNotice(
      `Đã nạp ${newTypes.length} loại phòng kèm ${copiedAssets} loại tài sản, ${newCommon.length} mục tài sản chung, ${newFees.length} biểu phí và ${newRules.length} nội quy. Giá thuê được xác nhận theo từng loại phòng ở bước tiếp theo.`,
    );
  };
  const finish = async () => {
    if (!owner || !confirmSave || lock.current) return;
    for (const step of stepOrder.slice(0, 6)) {
      const problem = validateSetupStep(draft, step);
      if (problem) {
        setError(problem);
        setDraft((previous) => ({ ...previous, step }));
        return;
      }
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const input = toLocationSetupInput(draft);
      const payload = JSON.stringify(input);
      const key =
        draft.submittedPayload === payload && draft.submittedKey ? draft.submittedKey : uid();
      const submitted = { ...draft, submittedPayload: payload, submittedKey: key };
      setDraft(submitted);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(submitted));
      } catch {
        /* storage unavailable */
      }
      const result = await api.complete(input, key);
      await onComplete(result);
      committed.current = true;
      sessionStorage.removeItem(storageKey);
    } catch (e) {
      setError(
        e instanceof ApiError
          ? invoiceError(e)
          : e instanceof Error
            ? e.message
            : 'Không thể hoàn tất thiết lập. Dữ liệu nháp được giữ để thử lại.',
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const reset = () => {
    setDraft(newDraft(initialSource));
    setCopySelection([]);
    setError('');
    setNotice('Đã bắt đầu bản nháp mới.');
    setConfirmSave(false);
  };
  const closeWizard = () => {
    if (busy || generating) return;
    // A final synchronous write prevents losing the newest keystroke when the
    // owner clicks outside or presses Escape before the autosave effect runs.
    try {
      sessionStorage.setItem(storageKey, JSON.stringify(draft));
      onClose();
    } catch {
      setDraftSaved(false);
      setError(
        'Không thể tự lưu bản nháp trên trình duyệt này. Hãy kiểm tra dung lượng lưu trữ trước khi đóng.',
      );
    }
  };

  if (!owner)
    return (
      <Dialog open onClose={onClose} fullWidth maxWidth="xs">
        <DialogTitle>Thiết lập cơ sở</DialogTitle>
        <DialogContent>
          <Alert severity="info">Chỉ Owner được thiết lập cơ sở mới.</Alert>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Đóng</Button>
        </DialogActions>
      </Dialog>
    );

  return (
    <>
      <Dialog open fullWidth fullScreen={mobile} maxWidth="lg" onClose={closeWizard}>
        <DialogTitle sx={{ px: { xs: 2, sm: 3 }, py: 1.5 }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Building2 size={24} />
            <Box>
              <Typography
                variant="h6"
                component="span"
                sx={{ fontWeight: 750, display: 'block', overflowWrap: 'anywhere' }}
              >
                Thiết lập cấu hình cơ sở ban đầu
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="body2" color="text.secondary">
                  {draft.location.name || 'Cơ sở mới'} · Bản nháp
                </Typography>
                {draftSaved ? (
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                    <CheckCircle2 size={14} color={theme.palette.success.main} />
                    <Typography variant="caption" color="success.main">
                      Đã tự lưu
                    </Typography>
                  </Stack>
                ) : (
                  <Typography variant="caption" color="error.main">
                    Không thể tự lưu trên trình duyệt này
                  </Typography>
                )}
              </Stack>
            </Box>
          </Stack>
        </DialogTitle>
        <Box
          component="nav"
          aria-label="Tiến độ thiết lập cơ sở"
          sx={{ px: { xs: 2, sm: 3 }, py: 1.5, bgcolor: 'background.default' }}
        >
          {compact ? (
            <Stack spacing={1}>
              <Stack
                direction="row"
                sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
              >
                <Typography variant="body2" sx={{ fontWeight: 700 }}>
                  Bước {stepPosition(draft.step) + 1}/{steps.length}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {steps[draft.step]}
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={((stepPosition(draft.step) + 1) / steps.length) * 100}
                aria-label="Tiến độ các bước"
              />
              <TextField
                select
                size="small"
                label="Đi đến bước"
                value={draft.step}
                onChange={(e) => changeStep(Number(e.target.value))}
                disabled={busy}
              >
                {stepOrder.map((step, index) => (
                  <MenuItem key={step} value={step}>
                    {index + 1}. {steps[step]}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          ) : (
            <Stepper
              activeStep={stepPosition(draft.step)}
              alternativeLabel
              nonLinear
              sx={{
                '& .MuiStepLabel-label': { mt: '6px !important', fontSize: 13 },
                '& .MuiStepButton-root': { py: 0.5 },
                '& .MuiStepIcon-root.Mui-completed': { color: 'success.main' },
              }}
            >
              {stepOrder.map((step, index) => (
                <Step key={step} completed={index < stepPosition(draft.step)}>
                  <StepButton
                    onClick={() => changeStep(step)}
                    disabled={busy}
                    aria-current={step === draft.step ? 'step' : undefined}
                  >
                    {steps[step]}
                  </StepButton>
                </Step>
              ))}
            </Stepper>
          )}
        </Box>
        <DialogContent
          ref={contentRef}
          dividers
          inert={busy}
          aria-busy={busy}
          sx={{ px: { xs: 2, sm: 3 }, py: 2, minHeight: 0, overflowX: 'hidden' }}
        >
          <Stack
            spacing={2}
            sx={{ minWidth: 0, '& .MuiTypography-root': { overflowWrap: 'anywhere' } }}
          >
            {busy && <LinearProgress />}
            {error && (
              <Alert severity="error" onClose={() => setError('')}>
                {error}
                {draft.step === 6 && (
                  <Typography variant="body2" sx={{ mt: 0.5 }}>
                    Bản nháp vẫn được giữ. Nếu mất kết nối, thử xác nhận lại với dữ liệu hiện tại;
                    nếu cấu hình xung đột, quay lại bước liên quan để kiểm tra.
                  </Typography>
                )}
              </Alert>
            )}
            {notice && (
              <Alert severity="success" onClose={() => setNotice('')}>
                {notice}
              </Alert>
            )}
            {(library.isError || !!library.data?.failures.length) && (
              <Alert
                severity="warning"
                action={<Button onClick={() => void library.refetch()}>Tải lại</Button>}
              >
                Một số thư viện chưa tải được:{' '}
                {library.data?.failures
                  .map(
                    (kind) =>
                      ({
                        'room-type-templates': 'mẫu phòng',
                        'asset-catalog': 'danh mục tài sản',
                        'asset-templates': 'gói tài sản',
                        'fee-templates': 'biểu phí',
                        'policy-templates': 'nội quy',
                      })[kind],
                  )
                  .join(', ') || 'toàn bộ'}
                . Các mẫu đã tải vẫn dùng được; bạn có thể tự tạo cấu hình.
              </Alert>
            )}
            {draft.step === 0 && (
              <>
                <Grid container spacing={2}>
                  {(
                    [
                      ['scratch', 'Tạo mới hoàn toàn', 'Chọn mẫu dùng chung hoặc tự cấu hình.'],
                      [
                        'copy',
                        'Sao chép từ cơ sở có sẵn',
                        'Chọn từng cấu hình để nạp vào bản nháp.',
                      ],
                    ] as const
                  ).map(([mode, title, description]) => (
                    <Grid size={{ xs: 12, md: 6 }} key={mode}>
                      <Paper
                        variant="outlined"
                        sx={{
                          p: 1.5,
                          borderColor: draft.mode === mode ? 'primary.main' : 'divider',
                          bgcolor: draft.mode === mode ? 'action.selected' : 'background.paper',
                        }}
                      >
                        <Button
                          fullWidth
                          variant="text"
                          startIcon={mode === 'copy' ? <Copy size={18} /> : <Building2 size={18} />}
                          disabled={!!draft.appliedSource && mode !== draft.mode}
                          aria-pressed={draft.mode === mode}
                          onClick={() => patch({ mode })}
                          sx={{ justifyContent: 'flex-start' }}
                        >
                          {title}
                        </Button>
                        <Typography variant="body2" color="text.secondary" sx={{ px: 1 }}>
                          {description}
                        </Typography>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>
                {draft.mode === 'copy' && (
                  <Paper variant="outlined" sx={{ p: 1.5 }}>
                    <Stack spacing={2}>
                      <Typography variant="caption" color="text.secondary">
                        Chỉ sao chép cấu hình, không sao chép dữ liệu vận hành.
                      </Typography>
                      <TextField
                        select
                        label="Cơ sở nguồn"
                        value={draft.sourceLocationId}
                        onChange={(e) => {
                          patch({ sourceLocationId: e.target.value });
                          setCopySelection([]);
                        }}
                        disabled={!!draft.appliedSource}
                      >
                        <MenuItem value="">Chọn cơ sở</MenuItem>
                        {locations.map((location) => (
                          <MenuItem key={location.id} value={location.id}>
                            {location.name}
                          </MenuItem>
                        ))}
                      </TextField>
                      {source.isFetching && <LinearProgress />}
                      {source.isError && (
                        <Alert
                          severity="error"
                          action={<Button onClick={() => void source.refetch()}>Thử lại</Button>}
                        >
                          Không thể đọc cấu hình nguồn.
                        </Alert>
                      )}
                      {source.data && (
                        <>
                          <Grid container spacing={2}>
                            {copyGroups(source.data).map((group) => (
                              <Grid key={group.kind} size={{ xs: 12, md: 6 }}>
                                <Box
                                  sx={{
                                    p: 1.5,
                                    border: '1px solid',
                                    borderColor: 'divider',
                                    borderRadius: '10px',
                                    minWidth: 0,
                                  }}
                                >
                                  <Stack spacing={0.5}>
                                    <Stack
                                      direction="row"
                                      sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                                    >
                                      <Typography sx={{ fontWeight: 700 }}>
                                        {group.label}
                                      </Typography>
                                      <Chip size="small" label={`${group.items.length} mục`} />
                                    </Stack>
                                    {!!group.items.length && (
                                      <FormControlLabel
                                        control={
                                          <Checkbox
                                            size="small"
                                            checked={group.items.every((item) =>
                                              copySelection.includes(`${group.kind}:${item.id}`),
                                            )}
                                            indeterminate={
                                              group.items.some((item) =>
                                                copySelection.includes(`${group.kind}:${item.id}`),
                                              ) &&
                                              !group.items.every((item) =>
                                                copySelection.includes(`${group.kind}:${item.id}`),
                                              )
                                            }
                                            onChange={(e) =>
                                              setCopySelection((previous) =>
                                                e.target.checked
                                                  ? [
                                                      ...new Set([
                                                        ...previous,
                                                        ...group.items.map(
                                                          (item) => `${group.kind}:${item.id}`,
                                                        ),
                                                      ]),
                                                    ]
                                                  : previous.filter(
                                                      (value) =>
                                                        !group.items.some(
                                                          (item) =>
                                                            value === `${group.kind}:${item.id}`,
                                                        ),
                                                    ),
                                              )
                                            }
                                          />
                                        }
                                        label={`Chọn tất cả ${group.label.toLocaleLowerCase('vi')}`}
                                      />
                                    )}
                                    {group.items.map((item) => (
                                      <FormControlLabel
                                        key={item.id}
                                        control={
                                          <Checkbox
                                            size="small"
                                            checked={copySelection.includes(
                                              `${group.kind}:${item.id}`,
                                            )}
                                            onChange={(e) =>
                                              setCopySelection((previous) =>
                                                e.target.checked
                                                  ? [...previous, `${group.kind}:${item.id}`]
                                                  : previous.filter(
                                                      (value) =>
                                                        value !== `${group.kind}:${item.id}`,
                                                    ),
                                              )
                                            }
                                          />
                                        }
                                        label={
                                          <Box>
                                            <Typography variant="body2">{item.name}</Typography>
                                            <Typography variant="caption" color="text.secondary">
                                              {item.detail}
                                            </Typography>
                                          </Box>
                                        }
                                      />
                                    ))}
                                    {!group.items.length && (
                                      <Typography variant="body2" color="text.secondary">
                                        Nguồn chưa có cấu hình phù hợp.
                                      </Typography>
                                    )}
                                  </Stack>
                                </Box>
                              </Grid>
                            ))}
                          </Grid>
                          <Button
                            variant="contained"
                            onClick={applyCopy}
                            disabled={!copySelection.length || source.isFetching || source.isError}
                          >
                            Nạp cấu hình đã chọn ({copySelection.length})
                          </Button>
                          <Typography variant="caption" color="text.secondary">
                            Giá thuê mặc định đi cùng loại phòng; biểu phí riêng cần ánh xạ phòng
                            đích ở bước 5.
                          </Typography>
                        </>
                      )}
                      {draft.appliedSource && (
                        <Alert severity="success">
                          Đã nạp bản sao độc lập. Bạn có thể sửa tại các bước tiếp theo.
                        </Alert>
                      )}
                    </Stack>
                  </Paper>
                )}
                <Divider />
                <Typography sx={{ fontWeight: 700 }}>Thông tin cơ sở mới</Typography>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, md: 8 }}>
                    <TextField
                      fullWidth
                      required
                      label="Tên cơ sở"
                      value={draft.location.name}
                      onChange={(e) => info({ name: e.target.value })}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <TextField
                      fullWidth
                      label="Mã cơ sở (tự động)"
                      helperText="Từ chữ cái đầu tên cơ sở; nếu trùng, hệ thống thêm -01, -02… khi lưu"
                      value={suggestedLocationCode(draft.location.name)}
                      slotProps={{ input: { readOnly: true } }}
                    />
                  </Grid>
                  <Grid size={12}>
                    <TextField
                      fullWidth
                      required
                      label="Địa chỉ"
                      value={draft.location.address}
                      onChange={(e) => info({ address: e.target.value })}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <TextField
                      fullWidth
                      required
                      type="number"
                      label="Số tầng"
                      value={draft.location.floors}
                      onChange={(e) => info({ floors: Number(e.target.value) })}
                      slotProps={{ htmlInput: { min: 1, max: 100 } }}
                    />
                  </Grid>
                  <Grid size={12}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, mt: 0.5 }}>
                      Liên hệ và mô tả (không bắt buộc)
                    </Typography>
                  </Grid>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <TextField
                      fullWidth
                      label="Số điện thoại liên hệ"
                      type="tel"
                      value={draft.location.contactPhone}
                      error={!!contactPhoneError(draft.location.contactPhone)}
                      helperText={contactPhoneError(draft.location.contactPhone)}
                      onChange={(e) => info({ contactPhone: e.target.value })}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <TextField
                      fullWidth
                      label="Email quản lý"
                      type="email"
                      value={draft.location.contactEmail}
                      onChange={(e) => info({ contactEmail: e.target.value })}
                    />
                  </Grid>
                  <Grid size={12}>
                    <TextField
                      fullWidth
                      multiline
                      minRows={2}
                      label="Mô tả & tiện ích chung"
                      value={draft.location.description}
                      onChange={(e) => info({ description: e.target.value })}
                    />
                  </Grid>
                </Grid>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={draft.activate}
                      onChange={(e) => patch({ activate: e.target.checked })}
                    />
                  }
                  label="Kích hoạt cơ sở sau khi lưu (nếu bỏ chọn, phòng mới sẽ ngừng khai thác)"
                />
              </>
            )}
            {draft.step === 1 && (
              <>
                <Stack
                  direction="row"
                  sx={{
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 1,
                  }}
                >
                  <Button
                    sx={{ ml: 'auto' }}
                    variant="contained"
                    startIcon={<Plus size={16} />}
                    onClick={() => setEditingType(newType())}
                  >
                    Thêm loại phòng
                  </Button>
                </Stack>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, md: 5 }}>
                    <SetupTemplatePicker
                      title="Loại phòng mẫu"
                      libraryActions={libraryActions}
                      kind="room-type"
                      items={all('room-type-templates').map((doc) => {
                        const data = doc.data as RoomTemplateData;
                        return {
                          id: doc.id,
                          name: doc.name,
                          detail: `${data.area} m² · ${data.capacity} người`,
                        };
                      })}
                      selected={all('room-type-templates')
                        .filter((doc) =>
                          draft.roomTypes.some((type) =>
                            matchesRoomTemplate(type, doc, sameFamily),
                          ),
                        )
                        .map((doc) => doc.id)}
                      add={addType}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 7 }}>
                    <SetupDropZone kind="room-type" add={addType}>
                      <Stack spacing={1.5}>
                        <Typography sx={{ fontWeight: 700 }}>
                          Cấu hình riêng ({draft.roomTypes.length})
                        </Typography>
                        {draft.roomTypes.map((type) => (
                          <Paper key={type.key} variant="outlined" sx={{ p: 1.5 }}>
                            <Stack spacing={1}>
                              <Stack
                                direction="row"
                                sx={{
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  flexWrap: 'wrap',
                                  gap: 1,
                                }}
                              >
                                <Typography sx={{ fontWeight: 750 }}>{type.name}</Typography>
                                <Chip
                                  size="small"
                                  label={type.sourceId ? 'Bản sao độc lập' : 'Tạo riêng'}
                                />
                              </Stack>
                              <Typography variant="body2">
                                {type.area} m² · {type.capacity} người · {type.assets.length} loại
                                tài sản ·{' '}
                                {type.referenceRent == null
                                  ? 'Chưa đặt giá thuê'
                                  : `${money(type.referenceRent)}/tháng`}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {type.description || type.amenities.join(' · ') || 'Chưa có mô tả'}
                              </Typography>
                              <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                                <Button size="small" onClick={() => setEditingType({ ...type })}>
                                  Chỉnh sửa
                                </Button>
                                <Button
                                  size="small"
                                  onClick={() =>
                                    setEditingType({
                                      ...type,
                                      key: uid(),
                                      name: `${type.name} (bản sao)`,
                                      assets: type.assets.map((item) => ({ ...item })),
                                    })
                                  }
                                >
                                  Nhân bản
                                </Button>
                                <Button
                                  size="small"
                                  color="error"
                                  onClick={() => removeType(type.key)}
                                >
                                  Bỏ
                                </Button>
                              </Stack>
                            </Stack>
                          </Paper>
                        ))}
                        {!draft.roomTypes.length && (
                          <Typography
                            variant="body2"
                            color="text.secondary"
                            sx={{ py: 2, textAlign: 'center' }}
                          >
                            Chưa có loại phòng.
                          </Typography>
                        )}
                      </Stack>
                    </SetupDropZone>
                  </Grid>
                </Grid>
              </>
            )}
            {draft.step === 2 && (
              <>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 3 }}>
                      <TextField
                        fullWidth
                        select
                        label="Tầng"
                        value={floor}
                        onChange={(e) => setFloor(e.target.value)}
                      >
                        {Array.from(
                          { length: Math.min(100, Math.max(1, draft.location.floors)) },
                          (_, index) => (
                            <MenuItem key={index} value={String(index + 1)}>
                              Tầng {index + 1}
                            </MenuItem>
                          ),
                        )}
                      </TextField>
                    </Grid>
                    <Grid size={{ xs: 12, md: 4 }}>
                      <TextField
                        fullWidth
                        select
                        label="Loại phòng"
                        value={currentType?.key ?? ''}
                        onChange={(e) => setTypeKey(e.target.value)}
                      >
                        {draft.roomTypes.map((type) => (
                          <MenuItem key={type.key} value={type.key}>
                            {type.name}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>
                    <Grid size={{ xs: 6, md: 2 }}>
                      <TextField
                        fullWidth
                        label="Tiền tố mã"
                        value={prefix}
                        onChange={(e) => setPrefix(e.target.value)}
                      />
                    </Grid>
                    <Grid size={{ xs: 6, md: 2 }}>
                      <TextField
                        fullWidth
                        label="Số lượng phòng"
                        type="number"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                      />
                    </Grid>
                    <Grid size={12}>
                      <Button
                        variant="contained"
                        startIcon={
                          generating ? (
                            <CircularProgress size={16} color="inherit" />
                          ) : (
                            <Sparkles size={16} />
                          )
                        }
                        onClick={generate}
                        disabled={generating}
                      >
                        {generating ? 'Đang sinh phòng...' : 'Sinh phòng xem trước'}
                      </Button>
                    </Grid>
                  </Grid>
                </Paper>
                <TextField
                  type="date"
                  label="Ngày hiệu lực giá thuê"
                  value={draft.rentEffectiveFrom}
                  onChange={(e) => patch({ rentEffectiveFrom: e.target.value })}
                  slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: today() } }}
                />{' '}
                <Stack
                  direction="row"
                  sx={{
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1,
                    flexWrap: 'wrap',
                  }}
                >
                  <Typography sx={{ fontWeight: 700 }}>
                    Danh sách phòng nháp ({draft.rooms.length})
                  </Typography>
                  <Button
                    color="error"
                    variant="outlined"
                    size="small"
                    startIcon={<Trash2 size={16} />}
                    disabled={!draft.rooms.length || generating}
                    onClick={() => setConfirmClearRooms(true)}
                  >
                    Xóa hết phòng
                  </Button>
                </Stack>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mb: 1.5 }}
                  >
                    Chọn một phòng trên ma trận để xem thông tin, đổi loại phòng hoặc đặt giá riêng.
                  </Typography>
                  <Stack spacing={2}>
                    {Array.from(new Set(draft.rooms.map((room) => room.floor)))
                      .sort((a, b) => Number(a) - Number(b))
                      .map((level) => (
                        <Box key={level}>
                          <Typography variant="subtitle2" sx={{ mb: 1 }}>
                            Tầng {level}
                          </Typography>
                          <Box
                            sx={{
                              display: 'grid',
                              gridTemplateColumns: 'repeat(auto-fill, minmax(128px, 1fr))',
                              gap: 1,
                            }}
                          >
                            {draft.rooms
                              .filter((room) => room.floor === level)
                              .map((room) => {
                                const type = draft.roomTypes.find(
                                  (item) => item.key === room.roomTypeKey,
                                );
                                return (
                                  <Button
                                    key={room.key}
                                    variant="outlined"
                                    color="inherit"
                                    aria-label={`Xem phòng ${room.roomNumber}`}
                                    onClick={() => setEditingRoomKey(room.key)}
                                    sx={{
                                      minHeight: 76,
                                      textTransform: 'none',
                                      borderColor: 'divider',
                                      display: 'flex',
                                      flexDirection: 'column',
                                      alignItems: 'flex-start',
                                      textAlign: 'left',
                                      px: 1.5,
                                      '&:hover': {
                                        borderColor: 'primary.main',
                                        bgcolor: 'action.hover',
                                      },
                                    }}
                                  >
                                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                                      {room.roomNumber}
                                    </Typography>
                                    <Typography
                                      variant="caption"
                                      color="text.secondary"
                                      sx={{ maxWidth: '100%' }}
                                      noWrap
                                    >
                                      {type?.name ?? 'Chưa có loại phòng'}
                                    </Typography>
                                    <Typography
                                      variant="caption"
                                      color={room.rent === null ? 'text.secondary' : 'primary.main'}
                                    >
                                      {money(room.rent ?? type?.referenceRent ?? null)}
                                    </Typography>
                                  </Button>
                                );
                              })}
                          </Box>
                        </Box>
                      ))}
                    {!draft.rooms.length && (
                      <Typography
                        color="text.secondary"
                        variant="body2"
                        sx={{ textAlign: 'center', py: 3 }}
                      >
                        Chưa có phòng nháp. Chọn tầng, loại phòng và số lượng để sinh phòng.
                      </Typography>
                    )}
                  </Stack>
                </Paper>
              </>
            )}
            {draft.step === 3 && (
              <>
                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                  <Button
                    variant={assetScope === 'Room' ? 'contained' : 'outlined'}
                    aria-pressed={assetScope === 'Room'}
                    onClick={() => setAssetScope('Room')}
                  >
                    Tài sản theo phòng
                  </Button>
                  <Button
                    variant={assetScope === 'Location' ? 'contained' : 'outlined'}
                    aria-pressed={assetScope === 'Location'}
                    onClick={() => setAssetScope('Location')}
                  >
                    Tài sản chung cơ sở
                  </Button>
                </Stack>
                {assetScope === 'Room' ? (
                  <>
                    <TextField
                      select
                      label="Loại phòng đang cấu hình"
                      value={assetType?.key ?? ''}
                      onChange={(e) => setAssetTypeKey(e.target.value)}
                    >
                      {draft.roomTypes.map((type) => (
                        <MenuItem key={type.key} value={type.key}>
                          {type.name}
                        </MenuItem>
                      ))}
                    </TextField>
                    <Grid container spacing={2}>
                      <Grid size={{ xs: 12, md: 5 }}>
                        <SetupTemplatePicker
                          title="Danh mục tài sản"
                          libraryActions={libraryActions}
                          kind="asset"
                          add={addAsset}
                          selected={selectedCatalogIds}
                          items={catalogAssets.map((doc) => ({
                            id: doc.id,
                            name: doc.name,
                            detail: `Đơn vị ${(doc.data as AssetCatalogData).unit} · ${money((doc.data as AssetCatalogData).referencePrice)}`,
                          }))}
                        >
                          <Button
                            fullWidth
                            variant="outlined"
                            startIcon={<Plus size={16} />}
                            disabled={
                              !assetType ||
                              !remainingCatalog.length ||
                              library.isFetching ||
                              library.isError ||
                              !!library.data?.failures.includes('asset-catalog')
                            }
                            onClick={() => addCatalogAssets(remainingCatalog)}
                          >
                            Nạp toàn bộ danh mục
                          </Button>
                        </SetupTemplatePicker>
                      </Grid>
                      <Grid size={{ xs: 12, md: 7 }}>
                        <SetupDropZone kind="asset" add={addAsset}>
                          <Stack spacing={1.5}>
                            <Stack
                              direction="row"
                              sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
                            >
                              <Box sx={{ minWidth: 0 }}>
                                <Typography
                                  variant="subtitle1"
                                  sx={{ fontWeight: 700, overflowWrap: 'anywhere' }}
                                >
                                  {assetType?.name ?? 'Chưa chọn loại phòng'}
                                </Typography>
                                <Typography variant="body2" color="text.secondary">
                                  {assetType?.assets.length ?? 0} loại tài sản ·{' '}
                                  {
                                    draft.rooms.filter(
                                      (room) => room.roomTypeKey === assetType?.key,
                                    ).length
                                  }{' '}
                                  phòng
                                </Typography>
                              </Box>
                            </Stack>
                            {assetType?.assetTemplateSourceName && (
                              <Alert severity="info" variant="outlined">
                                Tài sản được sao chép cùng loại phòng từ mẫu{' '}
                                <strong>{assetType.assetTemplateSourceName}</strong>
                                {assetType.assetTemplateSourceVersion
                                  ? ` · phiên bản ${assetType.assetTemplateSourceVersion}`
                                  : ''}
                                . Bạn có thể điều chỉnh số lượng và đơn vị tại đây.
                              </Alert>
                            )}
                            <Box
                              role="list"
                              aria-label="Tài sản đã chọn"
                              sx={{ borderTop: '1px solid', borderColor: 'divider' }}
                            >
                              {assetType?.assets.map((asset, index) => (
                                <Stack
                                  role="listitem"
                                  key={index}
                                  direction={{ xs: 'column', sm: 'row' }}
                                  spacing={1.5}
                                  sx={{
                                    alignItems: { sm: 'center' },
                                    py: 1.25,
                                    minWidth: 0,
                                    borderBottom: '1px solid',
                                    borderColor: 'divider',
                                  }}
                                >
                                  <Box
                                    sx={{ color: 'text.secondary', display: 'flex', flexShrink: 0 }}
                                  >
                                    <Package size={19} />
                                  </Box>
                                  <Box sx={{ minWidth: 0, flex: '1 1 0' }}>
                                    <Typography sx={{ fontWeight: 650, overflowWrap: 'anywhere' }}>
                                      {asset.name || 'Tài sản chưa đặt tên'}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {asset.unit ? `Đơn vị: ${asset.unit}` : 'Chưa đặt đơn vị'}
                                    </Typography>
                                  </Box>
                                  <TextField
                                    size="small"
                                    type="number"
                                    label="Số lượng"
                                    value={asset.quantity}
                                    slotProps={{ htmlInput: { min: 1, max: 10000, step: 1 } }}
                                    sx={{ width: { xs: '100%', sm: 112 }, flexShrink: 0 }}
                                    onChange={(event) =>
                                      updateType(assetType.key, {
                                        assets: assetType.assets.map((item, i) =>
                                          i === index
                                            ? { ...item, quantity: Number(event.target.value) }
                                            : item,
                                        ),
                                      })
                                    }
                                  />
                                  <TextField
                                    select
                                    size="small"
                                    label="Đơn vị"
                                    value={asset.unit ?? ''}
                                    sx={{ width: { xs: '100%', sm: 132 }, flexShrink: 0 }}
                                    onChange={(event) =>
                                      updateType(assetType.key, {
                                        assets: assetType.assets.map((item, i) =>
                                          i === index
                                            ? { ...item, unit: event.target.value || null }
                                            : item,
                                        ),
                                      })
                                    }
                                  >
                                    <MenuItem value="">Chưa đặt</MenuItem>
                                    {asset.unit &&
                                      !ASSET_UNITS.includes(
                                        asset.unit as (typeof ASSET_UNITS)[number],
                                      ) && (
                                        <MenuItem value={asset.unit}>
                                          {asset.unit} · hiện tại
                                        </MenuItem>
                                      )}
                                    {ASSET_UNITS.map((unit) => (
                                      <MenuItem key={unit} value={unit}>
                                        {unit}
                                      </MenuItem>
                                    ))}
                                  </TextField>
                                  <Button
                                    color="error"
                                    aria-label={`Bỏ ${asset.name || 'tài sản chưa đặt tên'}`}
                                    onClick={() =>
                                      updateType(assetType.key, {
                                        assets: assetType.assets.filter((_, i) => i !== index),
                                      })
                                    }
                                    sx={{
                                      flexShrink: 0,
                                      minWidth: 44,
                                      alignSelf: { xs: 'flex-end', sm: 'center' },
                                    }}
                                  >
                                    <Trash2 size={16} />
                                  </Button>
                                </Stack>
                              ))}
                            </Box>
                            {!assetType?.assets.length && (
                              <Box sx={{ py: 3, textAlign: 'center' }}>
                                <Typography sx={{ fontWeight: 650 }}>Chưa chọn tài sản</Typography>
                                <Typography variant="body2" color="text.secondary">
                                  Chọn hoặc kéo tài sản từ danh mục bên trái.
                                </Typography>
                              </Box>
                            )}
                          </Stack>
                        </SetupDropZone>
                      </Grid>
                    </Grid>
                  </>
                ) : (
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, md: 5 }}>
                      <SetupTemplatePicker
                        title="Tài sản mẫu của cơ sở"
                        libraryActions={libraryActions}
                        kind="common-asset"
                        add={addCommonAsset}
                        selected={selectedCommonCatalogIds}
                        items={commonCatalog.map((doc) => ({
                          id: doc.id,
                          name: doc.name,
                          detail: `Đơn vị ${(doc.data as AssetCatalogData).unit} · ${money((doc.data as AssetCatalogData).referencePrice)}`,
                        }))}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, md: 7 }}>
                      <SetupDropZone kind="common-asset" add={addCommonAsset}>
                        <Stack spacing={1.5}>
                          <Box>
                            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                              Tài sản chung của cơ sở
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              Số lượng tính một lần cho cơ sở, theo khu vực sử dụng.
                            </Typography>
                          </Box>
                          {!draft.commonAssets.length && (
                            <Typography variant="body2" color="text.secondary">
                              Chưa chọn tài sản chung. Chọn mẫu bên cạnh để thêm.
                            </Typography>
                          )}
                          {draft.commonAssets.map((asset) => (
                            <Stack
                              key={asset.id}
                              spacing={1}
                              sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1.5 }}
                            >
                              <Stack
                                direction="row"
                                sx={{
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: 1,
                                }}
                              >
                                <Box sx={{ minWidth: 0 }}>
                                  <Typography sx={{ fontWeight: 650, overflowWrap: 'anywhere' }}>
                                    {asset.name}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    Đơn vị: {asset.unit || 'Chưa đặt'}
                                  </Typography>
                                </Box>
                                <Button
                                  color="error"
                                  aria-label={`Bỏ tài sản chung ${asset.name}`}
                                  onClick={() =>
                                    setDraft((previous) => ({
                                      ...previous,
                                      commonAssets: previous.commonAssets.filter(
                                        (item) => item.id !== asset.id,
                                      ),
                                    }))
                                  }
                                >
                                  <Trash2 size={16} />
                                </Button>
                              </Stack>
                              <TextField
                                fullWidth
                                size="small"
                                required
                                label="Khu vực sử dụng"
                                placeholder="VD: Hành lang tầng 1"
                                slotProps={{ htmlInput: { maxLength: 200 } }}
                                value={asset.commonArea}
                                onChange={(event) =>
                                  updateCommonAsset(asset.id, { commonArea: event.target.value })
                                }
                              />
                              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                                <TextField
                                  fullWidth
                                  size="small"
                                  type="number"
                                  label="Số lượng"
                                  value={asset.quantity}
                                  slotProps={{ htmlInput: { min: 1, max: 10000, step: 1 } }}
                                  onChange={(event) =>
                                    updateCommonAsset(asset.id, {
                                      quantity: Number(event.target.value),
                                    })
                                  }
                                />
                                <TextField
                                  select
                                  fullWidth
                                  size="small"
                                  label="Đơn vị"
                                  value={asset.unit ?? ''}
                                  onChange={(event) =>
                                    updateCommonAsset(asset.id, {
                                      unit: event.target.value || null,
                                    })
                                  }
                                >
                                  <MenuItem value="">Chưa đặt</MenuItem>
                                  {[
                                    ...new Set([
                                      ...ASSET_UNITS,
                                      ...(asset.unit ? [asset.unit] : []),
                                    ]),
                                  ].map((unit) => (
                                    <MenuItem key={unit} value={unit}>
                                      {unit}
                                    </MenuItem>
                                  ))}
                                </TextField>
                              </Stack>
                            </Stack>
                          ))}
                        </Stack>
                      </SetupDropZone>
                    </Grid>
                  </Grid>
                )}
              </>
            )}
            {draft.step === 4 && (
              <>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  sx={{
                    alignItems: 'flex-end',
                    justifyContent: 'flex-end',
                    gap: 1,
                  }}
                >
                  <Button
                    size="small"
                    endIcon={<ChevronDown size={16} />}
                    onClick={() => {
                      billingPreviewRef.current?.scrollIntoView({ block: 'start' });
                      billingPreviewRef.current?.focus({ preventScroll: true });
                    }}
                  >
                    Xem mô phỏng chi phí
                  </Button>
                </Stack>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <SetupTemplatePicker
                      title="Mẫu biểu phí"
                      libraryActions={libraryActions}
                      kind="fee"
                      add={addFee}
                      selected={all('fee-templates')
                        .filter((doc) =>
                          draft.fees.some((fee) => matchesFeeTemplate(fee, doc, sameFamily)),
                        )
                        .map((doc) => doc.id)}
                      items={all('fee-templates')
                        .filter(
                          (doc) => categoryNumber((doc.data as FeeTemplateData).category) !== 0,
                        )
                        .map((doc) => {
                          const data = doc.data as FeeTemplateData;
                          return {
                            id: doc.id,
                            name: doc.name,
                            detail: `${money(data.referenceRate)}/${feeUnitLabel(categoryNumber(data.category), methodNumber(data.method))} · ${data.scope === 'Room' ? 'Theo phòng' : 'Toàn cơ sở'}`,
                          };
                        })}
                      empty="Chưa có mẫu phí dịch vụ, điện hoặc nước. Giá thuê được xác nhận tại bước Tạo phòng."
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 8 }}>
                    <SetupDropZone kind="fee" add={addFee}>
                      <Stack spacing={1.5}>
                        <Stack
                          direction="row"
                          sx={{
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 1,
                          }}
                        >
                          <Typography sx={{ fontWeight: 700 }}>
                            Biểu phí bổ sung ({draft.fees.length})
                          </Typography>
                          <Button
                            startIcon={<Plus size={16} />}
                            onClick={() => {
                              const fee = newFee();
                              patch({ fees: [...draft.fees, fee] });
                              setEditingFeeKey(fee.key);
                            }}
                          >
                            Thêm khoản phí
                          </Button>
                        </Stack>
                        {draft.fees.map((fee) => (
                          <Accordion
                            key={fee.key}
                            variant="outlined"
                            disableGutters
                            expanded={
                              editingFeeKey === fee.key || (!!fee.requiresRoom && !fee.roomKey)
                            }
                            onChange={(_, expanded) => setEditingFeeKey(expanded ? fee.key : '')}
                            sx={{
                              boxShadow: 'none',
                              borderRadius: '12px !important',
                              '&:before': { display: 'none' },
                              minWidth: 0,
                            }}
                          >
                            <AccordionSummary
                              expandIcon={<ChevronDown size={18} />}
                              aria-label={`Chỉnh sửa ${fee.name || 'khoản phí mới'}`}
                              sx={{
                                px: 1.5,
                                '& .MuiAccordionSummary-content': { minWidth: 0, my: 1.25 },
                              }}
                            >
                              <Box
                                sx={{
                                  display: 'grid',
                                  gridTemplateColumns: {
                                    xs: 'minmax(0,1fr)',
                                    sm: 'minmax(0,1fr) minmax(0,auto)',
                                  },
                                  gap: 1,
                                  alignItems: 'center',
                                  width: '100%',
                                  minWidth: 0,
                                  pr: 1,
                                }}
                              >
                                <Box sx={{ minWidth: 0 }}>
                                  <Typography sx={{ fontWeight: 650, overflowWrap: 'anywhere' }}>
                                    {fee.name || 'Khoản phí mới'}
                                  </Typography>
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ display: 'block', overflowWrap: 'anywhere' }}
                                  >
                                    {categories[fee.category]} ·{' '}
                                    {fee.roomKey === null
                                      ? 'Toàn cơ sở'
                                      : draft.rooms.find((room) => room.key === fee.roomKey)
                                          ?.roomNumber || 'Cần chọn phòng đích'}
                                  </Typography>
                                  <Typography
                                    variant="caption"
                                    color="text.secondary"
                                    sx={{ display: 'block' }}
                                  >
                                    Từ {dateLabel(fee.effectiveFrom)}
                                    {fee.effectiveTo ? ` đến ${dateLabel(fee.effectiveTo)}` : ''}
                                  </Typography>
                                </Box>
                                <Box sx={{ minWidth: 0, textAlign: { sm: 'right' } }}>
                                  <Typography
                                    sx={{
                                      fontWeight: 750,
                                      fontVariantNumeric: 'tabular-nums',
                                      overflowWrap: 'anywhere',
                                    }}
                                  >
                                    {validMoney(fee.rate) ? money(fee.rate) : 'Chưa nhập giá'}
                                  </Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    /{feeUnitLabel(fee.category, fee.method)}
                                  </Typography>
                                </Box>
                              </Box>
                            </AccordionSummary>
                            <AccordionDetails
                              sx={{
                                px: 1.5,
                                pb: 1.5,
                                pt: 1,
                                borderTop: '1px solid',
                                borderColor: 'divider',
                              }}
                            >
                              <Grid container spacing={1.5}>
                                <Grid size={{ xs: 12, sm: 6 }}>
                                  <TextField
                                    fullWidth
                                    size="small"
                                    label="Tên khoản thu"
                                    value={fee.name}
                                    onChange={(e) => updateFee(fee.key, { name: e.target.value })}
                                  />
                                </Grid>
                                <Grid size={{ xs: 12, sm: 6 }}>
                                  <TextField
                                    fullWidth
                                    size="small"
                                    label="Mã khoản thu"
                                    value={fee.chargeCode}
                                    disabled={fee.category !== 3}
                                    onChange={(e) =>
                                      updateFee(fee.key, {
                                        chargeCode: e.target.value.toUpperCase(),
                                      })
                                    }
                                  />
                                </Grid>
                                <Grid size={{ xs: 12, sm: 6 }}>
                                  <TextField
                                    fullWidth
                                    select
                                    size="small"
                                    label="Loại khoản thu"
                                    value={fee.category}
                                    onChange={(e) => {
                                      const category = Number(
                                        e.target.value,
                                      ) as SetupFee['category'];
                                      updateFee(fee.key, {
                                        category,
                                        method: category === 1 || category === 2 ? 1 : 0,
                                        rate: '',
                                        ...(category === 1
                                          ? { chargeCode: 'ELECTRICITY' }
                                          : category === 2
                                            ? { chargeCode: 'WATER' }
                                            : { chargeCode: '' }),
                                      });
                                    }}
                                  >
                                    {categories.slice(1).map((label, index) => (
                                      <MenuItem key={label} value={index + 1}>
                                        {label}
                                      </MenuItem>
                                    ))}
                                  </TextField>
                                </Grid>
                                <Grid size={{ xs: 12, sm: 6 }}>
                                  <TextField
                                    fullWidth
                                    select
                                    size="small"
                                    label="Phương thức tính"
                                    value={fee.method}
                                    disabled={fee.category !== 3}
                                    onChange={(e) =>
                                      updateFee(fee.key, {
                                        method: Number(e.target.value) as SetupFee['method'],
                                        rate: '',
                                      })
                                    }
                                  >
                                    {fee.category === 3 && [
                                      <MenuItem key={0} value={0}>
                                        Cố định/phòng/tháng
                                      </MenuItem>,
                                      <MenuItem key={2} value={2}>
                                        Cố định/người/tháng
                                      </MenuItem>,
                                    ]}
                                    {fee.category !== 3 && (
                                      <MenuItem value={1}>
                                        Theo chỉ số ({fee.category === 2 ? 'm³' : 'kWh'})
                                      </MenuItem>
                                    )}
                                  </TextField>
                                </Grid>
                                <Grid size={{ xs: 12, sm: 6 }}>
                                  <MoneyField
                                    fullWidth
                                    size="small"
                                    label={`Đơn giá (VND/${feeUnitLabel(fee.category, fee.method)})`}
                                    value={fee.rate}
                                    allowDecimal
                                    onValueChange={(raw) => updateFee(fee.key, { rate: raw })}
                                  />
                                </Grid>
                                <Grid size={{ xs: 12, sm: 6 }}>
                                  <TextField
                                    fullWidth
                                    select
                                    size="small"
                                    label="Phạm vi áp dụng"
                                    value={fee.roomKey === null ? 'location' : fee.roomKey}
                                    onChange={(e) =>
                                      updateFee(fee.key, {
                                        roomKey:
                                          e.target.value === 'location' ? null : e.target.value,
                                      })
                                    }
                                  >
                                    <MenuItem value="location" disabled={fee.requiresRoom}>
                                      Toàn cơ sở
                                    </MenuItem>
                                    <MenuItem value="">Chọn phòng đích</MenuItem>
                                    {draft.rooms.map((room) => (
                                      <MenuItem key={room.key} value={room.key}>
                                        {room.roomNumber}
                                      </MenuItem>
                                    ))}
                                  </TextField>
                                </Grid>
                                <Grid size={{ xs: 12, sm: 6 }}>
                                  <TextField
                                    fullWidth
                                    size="small"
                                    type="date"
                                    label="Hiệu lực từ"
                                    value={fee.effectiveFrom}
                                    onChange={(e) =>
                                      updateFee(fee.key, { effectiveFrom: e.target.value })
                                    }
                                    slotProps={{ inputLabel: { shrink: true } }}
                                  />
                                </Grid>
                                <Grid size={{ xs: 12, sm: 6 }}>
                                  <TextField
                                    fullWidth
                                    size="small"
                                    type="date"
                                    label="Hiệu lực đến"
                                    value={fee.effectiveTo ?? ''}
                                    onChange={(e) =>
                                      updateFee(fee.key, { effectiveTo: e.target.value || null })
                                    }
                                    slotProps={{ inputLabel: { shrink: true } }}
                                  />
                                </Grid>
                                <Grid size={12}>
                                  <Button
                                    color="error"
                                    size="small"
                                    onClick={() =>
                                      patch({
                                        fees: draft.fees.filter((item) => item.key !== fee.key),
                                      })
                                    }
                                  >
                                    Bỏ khoản phí
                                  </Button>
                                </Grid>
                              </Grid>
                            </AccordionDetails>
                          </Accordion>
                        ))}
                        {!draft.fees.length && (
                          <Typography color="text.secondary" variant="body2">
                            Chọn mẫu hoặc tạo khoản thu mới.
                          </Typography>
                        )}
                      </Stack>
                    </SetupDropZone>
                  </Grid>
                </Grid>
                <Box ref={billingPreviewRef} tabIndex={-1}>
                  <SetupBillingPreview
                    rooms={draft.rooms}
                    roomTypes={draft.roomTypes}
                    fees={draft.fees}
                    rentDate={draft.rentEffectiveFrom}
                  />
                </Box>
              </>
            )}
            {draft.step === 5 && (
              <>
                <Grid container spacing={2} sx={{ alignItems: 'start' }}>
                  <Grid size={{ xs: 12, md: 4 }} sx={{ minWidth: 0 }}>
                    <SetupTemplatePicker
                      title="Mẫu nội quy"
                      libraryActions={libraryActions}
                      kind="rule"
                      add={addRule}
                      selected={all('policy-templates')
                        .filter((doc) => draft.rules.some((rule) => sameFamily(rule.sourceId, doc)))
                        .map((doc) => doc.id)}
                      items={all('policy-templates').map((doc) => ({
                        id: doc.id,
                        name: doc.name,
                        detail: doc.description || 'Nội quy dùng chung',
                      }))}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, md: 8 }} sx={{ minWidth: 0 }}>
                    <SetupDropZone kind="rule" add={addRule}>
                      <Stack spacing={2}>
                        <Box>
                          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                            Nội quy áp dụng tại cơ sở
                          </Typography>
                        </Box>
                        <Box
                          sx={{
                            display: 'grid',
                            gridTemplateColumns: {
                              xs: 'minmax(0,1fr)',
                              sm: 'minmax(0,1fr) minmax(160px,220px)',
                            },
                            gap: 1.5,
                          }}
                        >
                          <TextField
                            fullWidth
                            label="Tên nội quy công bố"
                            value={draft.policyTitle}
                            onChange={(e) => patch({ policyTitle: e.target.value })}
                          />
                          <TextField
                            fullWidth
                            type="date"
                            label="Ngày hiệu lực nội quy"
                            value={draft.policyDate}
                            onChange={(e) => patch({ policyDate: e.target.value })}
                            slotProps={{ inputLabel: { shrink: true } }}
                          />
                        </Box>
                        <Divider />
                        <Stack
                          direction="row"
                          sx={{
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            flexWrap: 'wrap',
                            gap: 1,
                          }}
                        >
                          <Typography sx={{ fontWeight: 700 }}>
                            Điều khoản đã chọn ({draft.rules.length})
                          </Typography>
                          <Button
                            startIcon={<Plus size={16} />}
                            onClick={() => {
                              const rule = { key: uid(), title: '', content: '' };
                              patch({ rules: [...draft.rules, rule] });
                              setEditingRuleKey(rule.key);
                            }}
                          >
                            Thêm riêng
                          </Button>
                        </Stack>
                        <Stack
                          component="ol"
                          aria-label="Điều khoản nội quy"
                          divider={<Divider />}
                          spacing={1.5}
                          sx={{ listStyle: 'none', p: 0, m: 0, minWidth: 0 }}
                        >
                          {draft.rules.map((rule, index) => (
                            <Box component="li" key={rule.key} sx={{ minWidth: 0 }}>
                              <Stack direction="row" sx={{ alignItems: 'flex-start', gap: 1 }}>
                                <Typography
                                  sx={{
                                    fontWeight: 700,
                                    flexShrink: 0,
                                    color: 'text.secondary',
                                    pt: 0.75,
                                  }}
                                >
                                  {index + 1}.
                                </Typography>
                                <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
                                  <Typography
                                    sx={{ fontWeight: 650, overflowWrap: 'anywhere', pt: 0.75 }}
                                  >
                                    {rule.title || 'Điều khoản mới'}
                                  </Typography>
                                </Box>
                                <Stack direction="row" sx={{ gap: 0.5, flexShrink: 0 }}>
                                  <Button
                                    size="small"
                                    aria-label={`Chỉnh sửa ${rule.title || 'điều khoản mới'}`}
                                    onClick={() =>
                                      setEditingRuleKey(editingRuleKey === rule.key ? '' : rule.key)
                                    }
                                  >
                                    {editingRuleKey === rule.key ? 'Xong' : 'Sửa'}
                                  </Button>
                                  <Button
                                    color="error"
                                    size="small"
                                    aria-label={`Bỏ ${rule.title || 'điều khoản mới'}`}
                                    onClick={() =>
                                      patch({
                                        rules: draft.rules.filter((item) => item.key !== rule.key),
                                      })
                                    }
                                    sx={{ minWidth: 44 }}
                                  >
                                    <Trash2 size={16} />
                                  </Button>
                                </Stack>
                              </Stack>
                              {editingRuleKey === rule.key ||
                              !rule.title.trim() ||
                              !rule.content.trim() ? (
                                <Stack spacing={1.5} sx={{ mt: 1, minWidth: 0 }}>
                                  <TextField
                                    fullWidth
                                    label="Tiêu đề điều khoản"
                                    value={rule.title}
                                    onChange={(e) =>
                                      patch({
                                        rules: draft.rules.map((item) =>
                                          item.key === rule.key
                                            ? { ...item, title: e.target.value }
                                            : item,
                                        ),
                                      })
                                    }
                                  />
                                  <TextField
                                    fullWidth
                                    multiline
                                    minRows={3}
                                    label="Nội dung điều khoản"
                                    value={rule.content}
                                    onChange={(e) =>
                                      patch({
                                        rules: draft.rules.map((item) =>
                                          item.key === rule.key
                                            ? { ...item, content: e.target.value }
                                            : item,
                                        ),
                                      })
                                    }
                                  />
                                </Stack>
                              ) : (
                                <Typography
                                  variant="body2"
                                  sx={{
                                    mt: 0.75,
                                    pl: 2.5,
                                    whiteSpace: 'pre-wrap',
                                    overflowWrap: 'anywhere',
                                    lineHeight: 1.65,
                                  }}
                                >
                                  {rule.content}
                                </Typography>
                              )}
                            </Box>
                          ))}
                        </Stack>
                        {!draft.rules.length && (
                          <Box sx={{ py: 3, textAlign: 'center' }}>
                            <Typography sx={{ fontWeight: 650 }}>Chưa chọn điều khoản</Typography>
                            <Typography variant="body2" color="text.secondary">
                              Chọn mẫu bên trái hoặc thêm điều khoản riêng. Có thể bổ sung sau.
                            </Typography>
                          </Box>
                        )}
                      </Stack>
                    </SetupDropZone>
                  </Grid>
                </Grid>
              </>
            )}
            {draft.step === 6 && (
              <>
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography variant="h6">{draft.location.name}</Typography>
                  <Typography color="text.secondary">
                    {draft.location.code} · {draft.location.address} · {draft.location.floors} tầng
                  </Typography>
                  <Typography variant="body2">
                    {draft.activate
                      ? 'Kích hoạt sau khi lưu; phòng có trạng thái trống, chưa xác nhận đủ điều kiện nhận khách.'
                      : 'Chưa kích hoạt; phòng mới ngừng khai thác đến khi được mở lại.'}
                  </Typography>
                  <Typography variant="body2">
                    Giá thuê từng phòng có hiệu lực từ {dateLabel(draft.rentEffectiveFrom)}.
                  </Typography>
                </Paper>
                <Grid
                  container
                  spacing={1.5}
                  sx={{ p: 1.5, border: '1px solid', borderColor: 'divider', borderRadius: '12px' }}
                >
                  {[
                    ['Loại phòng', draft.roomTypes.length],
                    ['Phòng', draft.rooms.length],
                    [
                      'Loại phòng có tài sản',
                      draft.roomTypes.filter((type) => type.assets.length).length,
                    ],
                    ['Biểu phí bổ sung', draft.fees.length],
                    ['Điều khoản nội quy', draft.rules.length],
                  ].map(([label, count]) => (
                    <Grid key={label} size={{ xs: 6, md: 2.4 }}>
                      <Box sx={{ py: 0.5, minWidth: 0 }}>
                        <Typography color="text.secondary" variant="body2">
                          {label}
                        </Typography>
                        <Typography
                          sx={{ fontSize: 20, fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}
                        >
                          {count}
                        </Typography>
                      </Box>
                    </Grid>
                  ))}
                </Grid>
                <Stack
                  direction="row"
                  sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    Loại phòng và tài sản
                  </Typography>
                  <Button onClick={() => changeStep(1)}>Sửa loại phòng</Button>
                </Stack>
                <TableContainer component={Paper} variant="outlined">
                  <Table
                    size="small"
                    aria-label="Loại phòng và tài sản xác nhận"
                    sx={{ minWidth: 650 }}
                  >
                    <TableHead>
                      <TableRow>
                        <TableCell>Loại phòng</TableCell>
                        <TableCell>Sức chứa / diện tích</TableCell>
                        <TableCell>Giá mặc định</TableCell>
                        <TableCell>Số lượng phòng</TableCell>
                        <TableCell>Các loại tài sản</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {draft.roomTypes.map((type) => (
                        <TableRow key={type.key}>
                          <TableCell>{type.name}</TableCell>
                          <TableCell>
                            {type.capacity} người / {type.area} m²
                          </TableCell>
                          <TableCell>{money(type.referenceRent)}/tháng</TableCell>
                          <TableCell>
                            {draft.rooms.filter((room) => room.roomTypeKey === type.key).length}
                          </TableCell>
                          <TableCell>
                            <Stack spacing={0.25}>
                              {type.assets.length ? (
                                type.assets.map((asset, index) => (
                                  <Typography key={`${asset.name}-${index}`} variant="body2">
                                    {asset.name} × {asset.quantity}
                                    {asset.unit ? ` ${asset.unit}` : ''}
                                  </Typography>
                                ))
                              ) : (
                                <Typography variant="body2" color="text.secondary">
                                  Không có
                                </Typography>
                              )}
                              {type.assetTemplateSourceName && (
                                <Typography variant="caption" color="text.secondary">
                                  Nguồn: {type.assetTemplateSourceName}
                                  {type.assetTemplateSourceVersion
                                    ? ` · phiên bản ${type.assetTemplateSourceVersion}`
                                    : ''}
                                </Typography>
                              )}
                            </Stack>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Stack
                  direction="row"
                  sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    Tài sản chung cơ sở
                  </Typography>
                  <Button
                    onClick={() => {
                      setAssetScope('Location');
                      changeStep(3);
                    }}
                  >
                    Sửa tài sản chung
                  </Button>
                </Stack>
                <Paper variant="outlined" sx={{ p: 1.5 }}>
                  {draft.commonAssets.length ? (
                    draft.commonAssets.map((asset) => (
                      <Typography key={asset.id} variant="body2">
                        {asset.commonArea} · {asset.name} × {asset.quantity} {asset.unit}
                      </Typography>
                    ))
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      Không có tài sản chung.
                    </Typography>
                  )}
                </Paper>
                <Stack
                  direction="row"
                  sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 1 }}
                >
                  <Typography sx={{ fontWeight: 700 }}>
                    Giá thuê thực tế từng phòng · hiệu lực {dateLabel(draft.rentEffectiveFrom)}
                  </Typography>
                  <Button onClick={() => changeStep(2)}>Sửa phòng</Button>
                </Stack>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small" aria-label="Giá thuê từng phòng" sx={{ minWidth: 440 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Phòng / tầng</TableCell>
                        <TableCell>Loại phòng</TableCell>
                        <TableCell align="right">Giá thuê (đ/tháng)</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {draft.rooms.map((room) => {
                        const type = draft.roomTypes.find((item) => item.key === room.roomTypeKey);
                        return (
                          <TableRow key={room.key}>
                            <TableCell>
                              {room.roomNumber} · {room.floor}
                            </TableCell>
                            <TableCell>{type?.name ?? 'Chưa chọn'}</TableCell>
                            <TableCell
                              align="right"
                              sx={{ fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}
                            >
                              {money(room.rent ?? type?.referenceRent ?? null)}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
                {draft.fees.length > 0 && (
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography sx={{ fontWeight: 700 }}>Biểu phí xác nhận</Typography>
                    {draft.fees.map((fee) => (
                      <Typography key={fee.key} variant="body2">
                        {fee.name} · {money(fee.rate)}/{feeUnitLabel(fee.category, fee.method)} ·{' '}
                        {fee.roomKey === null
                          ? 'Toàn cơ sở'
                          : draft.rooms.find((room) => room.key === fee.roomKey)?.roomNumber}{' '}
                        · từ {dateLabel(fee.effectiveFrom)}
                        {fee.effectiveTo
                          ? ` đến ${dateLabel(fee.effectiveTo)}`
                          : ' · không giới hạn ngày kết thúc'}
                      </Typography>
                    ))}
                  </Paper>
                )}
                {draft.rules.length > 0 && (
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography sx={{ fontWeight: 700 }}>
                      {draft.policyTitle} – công bố từ {dateLabel(draft.policyDate)}
                    </Typography>
                    {draft.rules.map((rule) => (
                      <Box key={rule.key} sx={{ mt: 1 }}>
                        <Typography sx={{ fontWeight: 700 }} variant="body2">
                          {rule.title}
                        </Typography>
                        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                          {rule.content}
                        </Typography>
                      </Box>
                    ))}
                  </Paper>
                )}
                {!draft.fees.length && (
                  <Typography variant="body2" color="text.secondary">
                    Chưa có biểu phí bổ sung. Có thể thiết lập sau khi lưu.
                  </Typography>
                )}
                {!draft.rules.length && (
                  <Typography variant="body2" color="text.secondary">
                    Chưa có nội quy. Có thể công bố sau khi lưu.
                  </Typography>
                )}
                <Divider />
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={confirmSave}
                      onChange={(e) => setConfirmSave(e.target.checked)}
                      disabled={busy}
                    />
                  }
                  label="Tôi xác nhận giá thuê, biểu phí, định mức và nội quy trên sẽ được áp dụng vào cơ sở mới."
                />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions
          sx={{
            px: { xs: 2, sm: 3 },
            py: 1.5,
            display: 'grid',
            gridTemplateColumns: { xs: '1fr 1fr', sm: 'auto 1fr auto auto auto' },
            gap: 1,
            '& > :not(style) ~ :not(style)': { ml: 0 },
            '& .MuiButton-root': { minHeight: { xs: 44, sm: 36 } },
          }}
        >
          <Button
            onClick={() => changeStep(stepOrder[stepPosition(draft.step) - 1])}
            disabled={busy || generating || draft.step === 0}
          >
            Quay lại
          </Button>
          <Box sx={{ display: { xs: 'none', sm: 'block' } }} />
          <Button color="secondary" onClick={reset} disabled={busy || generating}>
            Xóa nháp
          </Button>
          {draft.step < 6 ? (
            <Button
              variant="contained"
              onClick={() => changeStep(stepOrder[stepPosition(draft.step) + 1])}
              disabled={busy || generating}
              sx={{ whiteSpace: 'normal' }}
            >
              Tiếp tục ({steps[stepOrder[stepPosition(draft.step) + 1]]})
            </Button>
          ) : (
            <Button
              variant="contained"
              onClick={() => void finish()}
              disabled={busy || !confirmSave}
            >
              {busy ? 'Đang lưu...' : 'Xác nhận hoàn tất thiết lập'}
            </Button>
          )}
        </DialogActions>
      </Dialog>
      <Dialog
        open={confirmClearRooms}
        onClose={() => setConfirmClearRooms(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Xóa hết phòng nháp?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Xóa {draft.rooms.length} phòng vừa sinh trong bản nháp này. Các phòng đã lưu ở cơ sở
            khác không bị ảnh hưởng.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmClearRooms(false)}>Hủy</Button>
          <Button color="error" variant="contained" onClick={clearRooms}>
            Xóa hết phòng
          </Button>
        </DialogActions>
      </Dialog>
      {editingRoom && (
        <Dialog open onClose={() => setEditingRoomKey(null)} maxWidth="sm" fullWidth>
          <DialogTitle>Thông tin phòng {editingRoom.roomNumber}</DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="Mã phòng"
                value={editingRoom.roomNumber}
                slotProps={{ input: { readOnly: true } }}
              />
              <TextField
                label="Tầng"
                value={editingRoom.floor}
                slotProps={{ input: { readOnly: true } }}
              />
              <TextField
                select
                label="Loại phòng"
                value={editingRoom.roomTypeKey}
                onChange={(e) => updateRoom(editingRoom.key, { roomTypeKey: e.target.value })}
              >
                {draft.roomTypes.map((type) => (
                  <MenuItem key={type.key} value={type.key}>
                    {type.name}
                  </MenuItem>
                ))}
              </TextField>
              <Grid container spacing={2}>
                <Grid size={{ xs: 6 }}>
                  <TextField
                    fullWidth
                    label="Sức chứa"
                    value={editingRoomType ? `${editingRoomType.capacity} người` : ''}
                    slotProps={{ input: { readOnly: true } }}
                    helperText="Theo loại phòng"
                  />
                </Grid>
                <Grid size={{ xs: 6 }}>
                  <TextField
                    fullWidth
                    label="Diện tích"
                    value={editingRoomType ? `${editingRoomType.area} m²` : ''}
                    slotProps={{ input: { readOnly: true } }}
                    helperText="Theo loại phòng"
                  />
                </Grid>
              </Grid>
              <MoneyField
                label="Giá riêng (đ/tháng)"
                value={editingRoom.rent ?? ''}
                placeholder={
                  editingRoomType?.referenceRent == null ? '' : money(editingRoomType.referenceRent)
                }
                allowDecimal
                onValueChange={(raw) =>
                  updateRoom(editingRoom.key, { rent: raw === '' ? null : exactRent(raw) })
                }
                helperText={
                  editingRoom.rent === null
                    ? 'Để trống để dùng giá mặc định của loại phòng'
                    : 'Giá riêng chỉ áp dụng cho phòng này'
                }
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ justifyContent: 'space-between' }}>
            <Button
              color="error"
              startIcon={<Trash2 size={16} />}
              onClick={() => removeRoom(editingRoom.key)}
            >
              Xóa phòng
            </Button>
            <Button variant="contained" onClick={() => setEditingRoomKey(null)}>
              Hoàn tất
            </Button>
          </DialogActions>
        </Dialog>
      )}
      {libraryEditor && (
        <SharedTemplateEditor
          key={libraryEditor.resource}
          resource={libraryEditor.resource}
          document={libraryEditor.document}
          busy={librarySaving}
          error={libraryError}
          close={() => setLibraryEditor(null)}
          save={(input) => void saveLibraryTemplate(input)}
          setupCreation
          assetScope={assetScope}
        />
      )}
      {editingType && (
        <Dialog
          open
          onClose={() => setEditingType(null)}
          fullWidth
          maxWidth="sm"
          transitionDuration={0}
        >
          <DialogTitle>
            {draft.roomTypes.some((type) => type.key === editingType?.key)
              ? 'Chỉnh sửa loại phòng'
              : 'Thêm loại phòng riêng'}
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ pt: 1 }}>
              {error && <Alert severity="error">{error}</Alert>}
              {editingType && (
                <>
                  <TextField
                    label="Tên loại phòng"
                    value={editingType.name}
                    onChange={(e) => setEditingType({ ...editingType, name: e.target.value })}
                  />
                  <TextField
                    label="Mô tả"
                    value={editingType.description}
                    onChange={(e) =>
                      setEditingType({ ...editingType, description: e.target.value })
                    }
                  />
                  <TextField
                    type="number"
                    label="Sức chứa mặc định"
                    value={editingType.capacity}
                    onChange={(e) =>
                      setEditingType({ ...editingType, capacity: Number(e.target.value) })
                    }
                  />
                  <TextField
                    type="number"
                    label="Diện tích (m²)"
                    value={editingType.area}
                    onChange={(e) =>
                      setEditingType({ ...editingType, area: Number(e.target.value) })
                    }
                  />
                  <MoneyField
                    label="Giá thuê mặc định (đ/tháng)"
                    allowDecimal
                    value={editingType.referenceRent ?? ''}
                    onValueChange={(raw) =>
                      setEditingType({
                        ...editingType,
                        referenceRent: raw === '' ? null : exactRent(raw),
                      })
                    }
                  />{' '}
                  <TextField
                    label="Đặc điểm phòng (không bắt buộc)"
                    value={editingType.amenities.join(',')}
                    onChange={(e) =>
                      setEditingType({ ...editingType, amenities: e.target.value.split(',') })
                    }
                  />
                </>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditingType(null)}>Hủy</Button>
            <Button variant="contained" onClick={saveType}>
              Lưu loại phòng
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
