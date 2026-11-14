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
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronDown, Copy, Package, Plus, Sparkles, Trash2 } from 'lucide-react';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import {
  locationSetupClient,
  type LocationSetupInput,
  type LocationSetupInformation,
  type LocationSetupResult,
  type SetupAssetRequirement,
  type SetupFee,
  type SetupRoomDefaults,
  type LocationSetupSource,
  type SetupSourceReference,
} from '../../../../../../packages/client-core/src/locationSetup';
import type {
  AssetCatalogData,
  FeeTemplateData,
  PolicyTemplateData,
  RoomTemplateData,
  SharedDocument,
  SharedResource,
} from '../../../../../../packages/client-core/src/sharedConfiguration';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';
import { useSharedConfigurationApi } from '../../configuration/useSharedConfigurationApi';
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

const steps = [
  'Thông tin cơ sở',
  'Loại phòng',
  'Tạo phòng',
  'Tài sản & tiện nghi',
  'Giá & biểu phí',
  'Nội quy',
  'Xem lại & hoàn tất',
];
const libraryKinds: SharedResource[] = [
  'room-type-templates',
  'asset-catalog',
  'fee-templates',
  'policy-templates',
];
const money = (value: number | string | null) =>
  value === null ? 'Chưa đặt' : formatBillingDecimal(value) + ' đ';
const norm = (value: string) => value.trim().toLocaleLowerCase();
const uid = () => crypto.randomUUID();
const today = () => todayVietnam();
const validMoney = (value: number | string | null): boolean =>
  value !== null && /^\d{1,14}(?:\.\d{1,4})?$/.test(String(value));
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
type DraftType = Omit<SetupRoomDefaults, 'assets'> & {
  assets: DraftAsset[];
  rentSource?: SetupSourceReference;
};
type DraftFee = Omit<SetupFee, 'rate'> & {
  rate: number | string;
  key: string;
  sourceId?: string;
  reference?: SetupSourceReference;
  requiresRoom?: boolean;
};
type RuleSection = {
  key: string;
  title: string;
  content: string;
  sourceId?: string;
  reference?: SetupSourceReference;
};
type ImportedPackage = {
  id: string;
  name: string;
  items: SetupAssetRequirement[];
  reference?: SetupSourceReference;
  assignedTypeKeys?: string[];
  discarded?: boolean;
  suggestedTypeNames?: string[];
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
  rooms: DraftRoom[];
  fees: DraftFee[];
  rules: RuleSection[];
  policyTitle: string;
  policyDate: string;
  packages: ImportedPackage[];
  rentEffectiveFrom: string;
  sourceRent: number | string | null;
  sourceRentReference?: SetupSourceReference;
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

const matchesCatalog = (asset: DraftAsset, doc: SharedDocument) =>
  norm(asset.name) === norm(doc.name) &&
  norm(asset.category) === norm((doc.data as AssetCatalogData).category);

function mergeCatalogAssets(assets: DraftAsset[], documents: SharedDocument[]): DraftAsset[] {
  const merged = [...assets];
  for (const doc of documents) {
    if (doc.resource !== 'asset-catalog' || doc.status !== 'Published') continue;
    const index = merged.findIndex((asset) => matchesCatalog(asset, doc));
    const imported = reference('asset-catalog', doc);
    if (index >= 0) {
      const existing = merged[index];
      merged[index] = {
        ...existing,
        references: uniqueReferences([...(existing.references ?? []), imported]),
      };
    } else {
      merged.push({
        name: doc.name,
        category: (doc.data as AssetCatalogData).category,
        quantity: 1,
        trackingMode: 'BulkQuantity',
        references: [imported],
      });
    }
  }
  return merged;
}

function restoreCatalogSelections(draft: Draft): Draft {
  // Do not change a previously submitted request: an uncertain response must be retryable
  // with its original payload and idempotency key. Imported asset-package quantities also
  // have independent provenance and must not be reset.
  if (draft.submittedPayload) return draft;
  return {
    ...draft,
    roomTypes: draft.roomTypes.map((type) => ({
      ...type,
      assets: type.assets.map((asset) =>
        asset.references?.length && asset.references.every((ref) => ref.kind === 'asset-catalog')
          ? { ...asset, quantity: 1 }
          : asset,
      ),
    })),
  };
}
const newType = (
  referenceRent: number | string | null = null,
  rentSource?: SetupSourceReference,
): DraftType => ({
  key: uid(),
  name: '',
  description: '',
  capacity: 2,
  area: 20,
  referenceRent,
  rentSource,
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
  rooms: [],
  fees: [],
  rules: [],
  policyTitle: 'Nội quy cơ sở',
  policyDate: today(),
  packages: [],
  rentEffectiveFrom: today(),
  sourceRent: null,
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
    if (!/^[A-Za-z0-9_-]{1,50}$/.test(info.code.trim()))
      return 'Mã cơ sở chỉ gồm chữ cái không dấu, chữ số, dấu - hoặc _, tối đa 50 ký tự.';
    if (
      info.contactPhone.trim().length > 50 ||
      info.contactEmail.trim().length > 200 ||
      info.description.trim().length > 2000
    )
      return 'Thông tin liên hệ hoặc mô tả vượt độ dài cho phép.';
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
          type.area > 1000000 ||
          !validMoney(type.referenceRent),
      )
    )
      return 'Mỗi loại phòng cần tên, diện tích, sức chứa và giá thuê mặc định hợp lệ.';
    if (new Set(draft.roomTypes.map((type) => norm(type.name))).size !== draft.roomTypes.length)
      return 'Tên loại phòng không được trùng trong cơ sở.';
  }
  if (step === 2) {
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
          !asset.category.trim() ||
          !Number.isInteger(asset.quantity) ||
          asset.quantity < 1 ||
          asset.quantity > 10000,
      ),
    )
  )
    return 'Kiểm tra tài sản chưa có tên hoặc nhóm; có thể bỏ mục không hợp lệ rồi chọn lại từ thư viện.';
  if (
    step === 3 &&
    draft.packages.some(
      (item) =>
        !item.discarded &&
        !item.assignedTypeKeys?.some((key) => draft.roomTypes.some((type) => type.key === key)),
    )
  )
    return 'Hãy gán từng gói tài sản đã sao chép cho loại phòng hoặc xác nhận bỏ gói.';
  if (step === 4) {
    if (!draft.rentEffectiveFrom || draft.rentEffectiveFrom < today())
      return 'Chọn ngày hiệu lực giá thuê từ hôm nay trở đi.';
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
    if (
      draft.fees.some((a, i) =>
        draft.fees
          .slice(i + 1)
          .some(
            (b) =>
              a.roomKey === b.roomKey &&
              a.chargeCode === b.chargeCode &&
              a.effectiveFrom <= (b.effectiveTo ?? '9999-12-31') &&
              b.effectiveFrom <= (a.effectiveTo ?? '9999-12-31'),
          ),
      )
    )
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
      ...(type.rentSource ? [type.rentSource] : []),
      ...type.assets.flatMap((asset) => asset.references ?? []),
    ]),
    ...draft.fees.flatMap((fee) => (fee.reference ? [fee.reference] : [])),
    ...draft.rules.flatMap((rule) => (rule.reference ? [rule.reference] : [])),
    ...draft.packages.flatMap((item) =>
      item.reference &&
      !item.discarded &&
      item.assignedTypeKeys?.some((key) => draft.roomTypes.some((type) => type.key === key))
        ? [item.reference]
        : [],
    ),
  ]);
  return {
    location: {
      ...draft.location,
      name: draft.location.name.trim(),
      address: draft.location.address.trim(),
      code: draft.location.code.trim(),
      contactPhone: draft.location.contactPhone.trim(),
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
          return restoreCatalogSelections({ ...newDraft(initialSource), ...restored });
      }
    } catch {
      /* old draft unavailable */
    }
    return newDraft(initialSource);
  });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const committed = useRef(false);
  const [copySelection, setCopySelection] = useState<string[]>([]);
  const [floor, setFloor] = useState('1');
  const [typeKey, setTypeKey] = useState('');
  const [prefix, setPrefix] = useState('P.');
  const [quantity, setQuantity] = useState('4');
  const [assetTypeKey, setAssetTypeKey] = useState('');
  const [rentTypeKey, setRentTypeKey] = useState('');
  const [confirmSave, setConfirmSave] = useState(false);
  const [editingType, setEditingType] = useState<DraftType | null>(null);
  const [editingFeeKey, setEditingFeeKey] = useState('');
  const [editingRuleKey, setEditingRuleKey] = useState('');
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
    setDraft((previous) => ({ ...previous, location: { ...previous.location, ...change } }));
    setError('');
    setConfirmSave(false);
  };
  useEffect(() => {
    try {
      if (owner && !committed.current) sessionStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      /* storage may be disabled */
    }
  }, [draft, owner, storageKey]);

  const library = useQuery({
    queryKey: ['property-setup', 'location-setup-library', session?.userId],
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
          return [resource, items.filter((item) => item.status !== 'Archived')] as const;
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
    (library.data?.items[resource] ?? []).filter((item) => item.status === 'Published');
  const unpublished = (resources: SharedResource[]) =>
    resources.flatMap((resource) =>
      (library.data?.items[resource] ?? []).filter((item) => item.status === 'Draft'),
    );
  const librarySection =
    draft.step === 1
      ? {
          resources: ['room-type-templates'] as SharedResource[],
          path: '/configuration/room-types',
        }
      : draft.step === 3
        ? {
            resources: ['asset-catalog'] as SharedResource[],
            path: '/configuration/assets',
          }
        : draft.step === 4
          ? {
              resources: ['fee-templates'] as SharedResource[],
              path: '/configuration/pricing-fees',
            }
          : draft.step === 5
            ? {
                resources: ['policy-templates'] as SharedResource[],
                path: '/configuration/policies',
              }
            : null;
  const libraryActions = librarySection ? (
    <Stack spacing={0.5}>
      <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
        <Button size="small" disabled={library.isFetching} onClick={() => void library.refetch()}>
          Làm mới mẫu
        </Button>
        <Button
          size="small"
          component="a"
          href={librarySection.path}
          target="_blank"
          rel="noopener noreferrer"
        >
          Mở thư viện mẫu
        </Button>
      </Stack>
      {library.isFetching && <LinearProgress aria-label="Đang tải thư viện mẫu" />}
      {!library.isFetching &&
        unpublished(librarySection.resources).map((doc) => (
          <Typography key={doc.id} variant="caption" color="text.secondary">
            {doc.name} · Bản nháp, cần công bố
          </Typography>
        ))}
    </Stack>
  ) : null;
  const currentType = draft.roomTypes.find((type) => type.key === typeKey) ?? draft.roomTypes[0];
  const assetType = draft.roomTypes.find((type) => type.key === assetTypeKey) ?? draft.roomTypes[0];
  const rentType = draft.roomTypes.find((type) => type.key === rentTypeKey) ?? draft.roomTypes[0];
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
  const updateFee = (key: string, change: Partial<DraftFee>) =>
    setDraft((previous) => ({
      ...previous,
      fees: previous.fees.map((fee) => (fee.key === key ? { ...fee, ...change } : fee)),
    }));
  const changeStep = (next: number) => {
    if (busy) return;
    if (next !== draft.step) setNotice('');
    if (next > draft.step)
      for (let i = 0; i < next; i++) {
        const problem = validateSetupStep(draft, i);
        if (problem) {
          setError(problem);
          setDraft((previous) => ({ ...previous, step: i }));
          return;
        }
      }
    patch({ step: next });
  };
  const addType = (id: string) => {
    const template = all('room-type-templates').find((item) => item.id === id);
    if (!template) return;
    if (
      draft.roomTypes.some(
        (type) => type.sourceId === id || norm(type.name) === norm(template.name),
      )
    ) {
      setError('Loại phòng này đã có trong cấu hình cơ sở.');
      return;
    }
    const type = sourceType(template);
    if (type.referenceRent === null) {
      type.referenceRent = draft.sourceRent;
      type.rentSource = draft.sourceRentReference;
    }
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
      editingType.area <= 0 ||
      !validMoney(editingType.referenceRent)
    ) {
      setError('Nhập tên, diện tích, sức chứa và giá thuê hợp lệ.');
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
    patch({
      roomTypes: draft.roomTypes.filter((type) => type.key !== key),
      packages: draft.packages.map((item) => ({
        ...item,
        assignedTypeKeys: item.assignedTypeKeys?.filter((value) => value !== key),
      })),
    });
  };
  const generate = () => {
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
  };
  const catalogAssets = all('asset-catalog');
  const addCatalogAssets = (documents: SharedDocument[]) => {
    if (!assetType) return;
    setDraft((previous) => ({
      ...previous,
      roomTypes: previous.roomTypes.map((type) =>
        type.key === assetType.key
          ? { ...type, assets: mergeCatalogAssets(type.assets, documents) }
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
    .filter((doc) => assetType?.assets.some((asset) => matchesCatalog(asset, doc)))
    .map((doc) => doc.id);
  const remainingCatalog = catalogAssets.filter((doc) => !selectedCatalogIds.includes(doc.id));
  const applyPackageTo = (selected: ImportedPackage) => {
    if (!assetType || selected.discarded) return;
    const merged = [...assetType.assets];
    selected.items.forEach((item) => {
      const index = merged.findIndex(
        (asset) =>
          norm(asset.name) === norm(item.name) && norm(asset.category) === norm(item.category),
      );
      const refs = selected.reference ? [selected.reference] : [];
      if (index < 0) merged.push({ ...item, references: refs });
      else
        merged[index] = {
          ...merged[index],
          references: uniqueReferences([...(merged[index].references ?? []), ...refs]),
        };
    });
    patch({
      roomTypes: draft.roomTypes.map((type) =>
        type.key === assetType.key ? { ...type, assets: merged } : type,
      ),
      packages: draft.packages.map((item) =>
        item.id === selected.id
          ? {
              ...item,
              discarded: false,
              assignedTypeKeys: [...new Set([...(item.assignedTypeKeys ?? []), assetType.key])],
            }
          : item,
      ),
    });
    setNotice(`Đã nạp gói ${selected.name}; các mục đã có được giữ nguyên.`);
  };
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
      if (!rentType) {
        setError('Chọn loại phòng để áp dụng mẫu giá thuê.');
        return;
      }
      updateType(rentType.key, {
        referenceRent: exactRent(data.referenceRate),
        rentSource: reference('fee-templates', item),
      });
      setNotice(
        `Đã nạp giá tham khảo ${item.name} vào ${rentType.name}; giá phòng riêng vẫn được giữ.`,
      );
      return;
    }
    if (draft.fees.some((fee) => fee.sourceId === id)) {
      setError('Mẫu biểu phí đã được nạp.');
      return;
    }
    patch({
      fees: [
        ...draft.fees,
        {
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
        },
      ],
    });
  };
  const addRule = (id: string) => {
    const item = all('policy-templates').find((document) => document.id === id);
    if (!item || draft.rules.some((rule) => rule.sourceId === id)) return;
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
      label: 'Loại phòng & giá mặc định',
      kind: 'type',
      items: data.roomTypes
        .filter((doc) => doc.status !== 'Archived')
        .map((doc) => ({
          id: doc.id,
          name: doc.data.name,
          detail: `${doc.data.defaults.capacity} người · ${doc.data.defaults.area ?? 'Chưa khai báo'} m² · ${money(doc.data.defaults.referenceRent === null ? null : exactRent(doc.data.defaults.referenceRent))}/tháng`,
        })),
    },
    {
      label: 'Giá thuê tham khảo cấp cơ sở',
      kind: 'rent',
      items: data.fees
        .filter(
          (fee) =>
            categoryNumber(fee.category) === 0 &&
            !fee.roomId &&
            fee.effectiveFrom <= today() &&
            (!fee.effectiveTo || fee.effectiveTo >= today()),
        )
        .map((fee) => ({
          id: fee.id,
          name: fee.name,
          detail: `${money(fee.rate)}/tháng · chỉ dùng làm tham khảo`,
        })),
    },
    {
      label: 'Gói tài sản (định mức)',
      kind: 'asset',
      items: data.assetTemplates
        .filter((doc) => doc.status !== 'Archived')
        .map((doc) => ({
          id: doc.id,
          name: doc.data.name,
          detail: `${doc.data.items.length} mục`,
        })),
    },
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
          detail: `${doc.status === 'Published' ? 'Đã công bố' : 'Bản nháp'} · ${doc.data.effectiveFrom}`,
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
    const rents = data.fees.filter((fee) => selected('rent', fee.id));
    if (rents.length > 1) {
      setError('Chỉ chọn một giá thuê tham khảo cấp cơ sở.');
      return;
    }
    const sourceRent = rents.length ? exactRent(rents[0].rate) : draft.sourceRent;
    const sourceRentReference = rents.length
      ? reference('BillingPolicy', rents[0])
      : draft.sourceRentReference;
    const selectedPackages = data.assetTemplates
      .filter((doc) => selected('asset', doc.id))
      .map((doc) => ({
        id: doc.id,
        name: doc.data.name,
        reference: reference('AssetTemplate', doc),
        items: doc.data.items.map((item) => ({
          name: item.name,
          category: item.category,
          quantity: item.quantity,
          trackingMode: item.trackingMode,
        })),
        suggestedTypeNames: data.roomTypes
          .filter((type) => type.data.assetTemplateId === doc.id)
          .map((type) => type.data.name),
      }));
    const newTypes = data.roomTypes
      .filter(
        (doc) =>
          selected('type', doc.id) &&
          !draft.roomTypes.some(
            (type) => type.sourceId === doc.id || norm(type.name) === norm(doc.data.name),
          ),
      )
      .map((doc) => ({
        ...newType(),
        name: doc.data.name,
        description: doc.data.description ?? '',
        capacity: doc.data.defaults.capacity,
        area: Number(doc.data.defaults.area),
        referenceRent:
          doc.data.defaults.referenceRent === null
            ? sourceRent
            : exactRent(doc.data.defaults.referenceRent),
        rentSource: doc.data.defaults.referenceRent === null ? sourceRentReference : undefined,
        amenities: [...doc.data.defaults.amenities],
        sourceId: doc.id,
        sourceVersion: doc.version,
        sourceKind: 'RoomDefaults',
      }));
    const newFees = data.fees
      .filter(
        (fee) => selected('fee', fee.id) && !draft.fees.some((item) => item.sourceId === fee.id),
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
        effectiveFrom: today(),
        effectiveTo: fee.effectiveTo && fee.effectiveTo >= today() ? fee.effectiveTo : null,
      }));
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
    patch({
      appliedSource: draft.sourceLocationId,
      sourceState: data.sourceState,
      sourceRent,
      sourceRentReference,
      roomTypes: [
        ...draft.roomTypes.map((type) =>
          type.referenceRent === null
            ? { ...type, referenceRent: sourceRent, rentSource: sourceRentReference }
            : type,
        ),
        ...newTypes,
      ],
      fees: [...draft.fees, ...newFees],
      rules: [...draft.rules, ...newRules],
      packages: [
        ...draft.packages,
        ...selectedPackages.filter((item) => !draft.packages.some((p) => p.id === item.id)),
      ],
    });
    setNotice(
      `Đã nạp ${newTypes.length} loại phòng, ${selectedPackages.length} gói tài sản, ${newFees.length} biểu phí, ${newRules.length} nội quy. Kiểm tra và sửa ở các bước tiếp theo.`,
    );
  };
  const finish = async () => {
    if (!owner || !confirmSave || lock.current) return;
    for (let i = 0; i < 6; i++) {
      const problem = validateSetupStep(draft, i);
      if (problem) {
        setError(problem);
        setDraft((previous) => ({ ...previous, step: i }));
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
      <Dialog open fullWidth fullScreen={mobile} maxWidth="lg" onClose={busy ? undefined : onClose}>
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
              <Typography variant="body2" color="text.secondary">
                {draft.location.name || 'Cơ sở mới'} · Bản nháp
              </Typography>
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
                  Bước {draft.step + 1}/{steps.length}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {steps[draft.step]}
                </Typography>
              </Stack>
              <LinearProgress
                variant="determinate"
                value={((draft.step + 1) / steps.length) * 100}
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
                {steps.map((label, index) => (
                  <MenuItem key={label} value={index}>
                    {index + 1}. {label}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          ) : (
            <Stepper
              activeStep={draft.step}
              alternativeLabel
              nonLinear
              sx={{
                '& .MuiStepLabel-label': { mt: '6px !important', fontSize: 13 },
                '& .MuiStepButton-root': { py: 0.5 },
              }}
            >
              {steps.map((label, index) => (
                <Step key={label} completed={index < draft.step}>
                  <StepButton
                    onClick={() => changeStep(index)}
                    disabled={busy}
                    aria-current={index === draft.step ? 'step' : undefined}
                  >
                    {label}
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
                      required
                      label="Mã cơ sở"
                      helperText="Chữ cái không dấu, số, dấu - hoặc _"
                      slotProps={{ htmlInput: { maxLength: 50 } }}
                      value={draft.location.code}
                      onChange={(e) => info({ code: e.target.value })}
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
                      value={draft.location.contactPhone}
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
                  {draft.sourceRent !== null && (
                    <Typography variant="caption">
                      Giá thuê tham khảo từ cơ sở nguồn: {money(draft.sourceRent)}/tháng. Kiểm tra
                      và xác nhận cho từng loại phòng.
                    </Typography>
                  )}
                  <Button
                    sx={{ ml: 'auto' }}
                    variant="contained"
                    startIcon={<Plus size={16} />}
                    onClick={() =>
                      setEditingType(newType(draft.sourceRent, draft.sourceRentReference))
                    }
                  >
                    Thêm loại phòng
                  </Button>
                </Stack>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, md: 5 }}>
                    <SetupTemplatePicker
                      title="Mẫu loại phòng"
                      libraryActions={libraryActions}
                      kind="room-type"
                      items={all('room-type-templates').map((doc) => {
                        const data = doc.data as RoomTemplateData;
                        return {
                          id: doc.id,
                          name: doc.name,
                          detail: `${data.area} m² · ${data.capacity} người · ${money(data.referenceRent === null ? null : exactRent(data.referenceRent))}`,
                        };
                      })}
                      selected={draft.roomTypes.flatMap((type) =>
                        type.sourceId ? [type.sourceId] : [],
                      )}
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
                                {type.area} m² · {type.capacity} người · {money(type.referenceRent)}
                                /tháng
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
                        startIcon={<Sparkles size={16} />}
                        onClick={generate}
                      >
                        Sinh phòng xem trước
                      </Button>
                    </Grid>
                  </Grid>
                </Paper>
                <Typography sx={{ fontWeight: 700 }}>
                  Danh sách phòng nháp ({draft.rooms.length})
                </Typography>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small" aria-label="Danh sách phòng nháp" sx={{ minWidth: 760 }}>
                    <TableHead>
                      <TableRow>
                        <TableCell>Mã phòng</TableCell>
                        <TableCell>Tầng</TableCell>
                        <TableCell>Loại phòng</TableCell>
                        <TableCell>Sức chứa / diện tích</TableCell>
                        <TableCell>Giá riêng (đ/tháng)</TableCell>
                        <TableCell />
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {draft.rooms.map((room) => {
                        const type = draft.roomTypes.find((item) => item.key === room.roomTypeKey);
                        return (
                          <TableRow key={room.key}>
                            <TableCell>
                              <TextField
                                size="small"
                                sx={{ minWidth: 110 }}
                                value={room.roomNumber}
                                onChange={(e) =>
                                  updateRoom(room.key, { roomNumber: e.target.value })
                                }
                                slotProps={{ htmlInput: { 'aria-label': 'Mã phòng' } }}
                              />
                            </TableCell>
                            <TableCell>{room.floor}</TableCell>
                            <TableCell>
                              <TextField
                                select
                                size="small"
                                sx={{ minWidth: 140 }}
                                slotProps={{
                                  select: { 'aria-label': `Loại phòng ${room.roomNumber}` },
                                }}
                                value={room.roomTypeKey}
                                onChange={(e) =>
                                  updateRoom(room.key, { roomTypeKey: e.target.value })
                                }
                              >
                                {draft.roomTypes.map((item) => (
                                  <MenuItem key={item.key} value={item.key}>
                                    {item.name}
                                  </MenuItem>
                                ))}
                              </TextField>
                            </TableCell>
                            <TableCell>
                              {type?.capacity} người · {type?.area} m²
                            </TableCell>
                            <TableCell>
                              <MoneyField
                                size="small"
                                sx={{ minWidth: 160 }}
                                allowDecimal
                                value={room.rent ?? ''}
                                placeholder={
                                  type?.referenceRent == null ? '' : money(type.referenceRent)
                                }
                                onValueChange={(raw) =>
                                  updateRoom(room.key, {
                                    rent: raw === '' ? null : exactRent(raw),
                                  })
                                }
                                helperText={room.rent === null ? 'Dùng giá mặc định' : 'Giá riêng'}
                              />
                            </TableCell>
                            <TableCell>
                              <Button
                                color="error"
                                aria-label={`Xóa phòng ${room.roomNumber}`}
                                onClick={() =>
                                  patch({
                                    rooms: draft.rooms.filter((item) => item.key !== room.key),
                                    fees: draft.fees.map((fee) =>
                                      fee.roomKey === room.key ? { ...fee, roomKey: '' } : fee,
                                    ),
                                  })
                                }
                              >
                                <Trash2 size={16} />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              </>
            )}
            {draft.step === 3 && (
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
                {draft.packages.length > 0 && (
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Stack spacing={1}>
                      <Typography sx={{ fontWeight: 700 }}>Tài sản từ cơ sở nguồn</Typography>
                      {draft.packages.map((item) => (
                        <Stack
                          key={item.id}
                          direction={{ xs: 'column', md: 'row' }}
                          spacing={1}
                          sx={{ alignItems: { md: 'center' } }}
                        >
                          <Box sx={{ flex: 1 }}>
                            <Typography>
                              {item.name} · {item.items.length} mục
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {item.discarded
                                ? 'Đã xác nhận bỏ gói'
                                : item.assignedTypeKeys?.length
                                  ? 'Đã nạp vào: ' +
                                    draft.roomTypes
                                      .filter((type) => item.assignedTypeKeys?.includes(type.key))
                                      .map((type) => type.name)
                                      .join(', ')
                                  : 'Chưa gán'}
                              {item.suggestedTypeNames?.length
                                ? ' · Liên kết tại nguồn: ' + item.suggestedTypeNames.join(', ')
                                : ''}
                            </Typography>
                          </Box>
                          <Button
                            disabled={!assetType || item.discarded}
                            onClick={() => applyPackageTo(item)}
                          >
                            Gán cho {assetType?.name ?? 'loại phòng'}
                          </Button>
                          <Button
                            color="secondary"
                            disabled={!!item.assignedTypeKeys?.length}
                            onClick={() =>
                              patch({
                                packages: draft.packages.map((p) =>
                                  p.id === item.id ? { ...p, discarded: !p.discarded } : p,
                                ),
                              })
                            }
                          >
                            {item.discarded ? 'Khôi phục gói' : 'Không sử dụng gói'}
                          </Button>
                        </Stack>
                      ))}
                    </Stack>
                  </Paper>
                )}
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
                        detail: (doc.data as AssetCatalogData).category,
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
                                draft.rooms.filter((room) => room.roomTypeKey === assetType?.key)
                                  .length
                              }{' '}
                              phòng
                            </Typography>
                          </Box>
                        </Stack>
                        <Box
                          role="list"
                          aria-label="Tài sản đã chọn"
                          sx={{ borderTop: '1px solid', borderColor: 'divider' }}
                        >
                          {assetType?.assets.map((asset, index) => (
                            <Stack
                              role="listitem"
                              key={index}
                              direction="row"
                              spacing={1.5}
                              sx={{
                                alignItems: 'center',
                                py: 1.25,
                                minWidth: 0,
                                borderBottom: '1px solid',
                                borderColor: 'divider',
                              }}
                            >
                              <Box sx={{ color: 'text.secondary', display: 'flex', flexShrink: 0 }}>
                                <Package size={19} />
                              </Box>
                              <Box sx={{ minWidth: 0, flex: '1 1 0' }}>
                                <Typography sx={{ fontWeight: 650, overflowWrap: 'anywhere' }}>
                                  {asset.name || 'Tài sản chưa đặt tên'}
                                </Typography>
                                <Typography
                                  variant="caption"
                                  color="text.secondary"
                                  sx={{ overflowWrap: 'anywhere' }}
                                >
                                  {asset.category || 'Chưa có nhóm tài sản'}
                                </Typography>
                              </Box>
                              <Button
                                color="error"
                                aria-label={`Bỏ ${asset.name || 'tài sản chưa đặt tên'}`}
                                onClick={() =>
                                  updateType(assetType.key, {
                                    assets: assetType.assets.filter((_, i) => i !== index),
                                  })
                                }
                                sx={{ flexShrink: 0, minWidth: 44 }}
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
                      title="Mẫu giá & biểu phí"
                      libraryActions={libraryActions}
                      kind="fee"
                      add={addFee}
                      selected={[
                        ...draft.fees.flatMap((fee) => (fee.sourceId ? [fee.sourceId] : [])),
                        ...(rentType?.rentSource?.kind === 'fee-templates'
                          ? [rentType.rentSource.id]
                          : []),
                      ]}
                      items={all('fee-templates').map((doc) => {
                        const data = doc.data as FeeTemplateData;
                        return {
                          id: doc.id,
                          name: doc.name,
                          detail: `${money(data.referenceRate)}/${feeUnitLabel(categoryNumber(data.category), methodNumber(data.method))} · ${data.scope === 'Room' ? 'Theo phòng' : 'Toàn cơ sở'}`,
                        };
                      })}
                    >
                      <TextField
                        select
                        size="small"
                        label="Loại phòng nhận mẫu giá thuê"
                        value={rentType?.key ?? ''}
                        onChange={(e) => setRentTypeKey(e.target.value)}
                      >
                        {draft.roomTypes.map((type) => (
                          <MenuItem key={type.key} value={type.key}>
                            {type.name}
                          </MenuItem>
                        ))}
                      </TextField>
                    </SetupTemplatePicker>
                  </Grid>
                  <Grid size={{ xs: 12, md: 8 }}>
                    <SetupDropZone kind="fee" add={addFee}>
                      <Stack spacing={1.5}>
                        <Typography sx={{ fontWeight: 700 }}>
                          Giá mặc định theo loại phòng
                        </Typography>
                        <TextField
                          type="date"
                          label="Ngày hiệu lực giá thuê"
                          value={draft.rentEffectiveFrom}
                          onChange={(e) => patch({ rentEffectiveFrom: e.target.value })}
                          slotProps={{ inputLabel: { shrink: true }, htmlInput: { min: today() } }}
                        />
                        <Box sx={{ borderTop: '1px solid', borderColor: 'divider' }}>
                          {draft.roomTypes.map((type) => (
                            <Box
                              key={type.key}
                              sx={{
                                display: 'grid',
                                gridTemplateColumns: {
                                  xs: 'minmax(0,1fr)',
                                  sm: 'minmax(0,1fr) minmax(160px,220px)',
                                },
                                gap: 1.5,
                                alignItems: 'center',
                                py: 1.25,
                                borderBottom: '1px solid',
                                borderColor: 'divider',
                              }}
                            >
                              <Box sx={{ minWidth: 0 }}>
                                <Typography sx={{ fontWeight: 650, overflowWrap: 'anywhere' }}>
                                  {type.name}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {
                                    draft.rooms.filter((room) => room.roomTypeKey === type.key)
                                      .length
                                  }{' '}
                                  phòng · {type.capacity} người/phòng
                                </Typography>
                              </Box>
                              <MoneyField
                                fullWidth
                                size="small"
                                label="Giá thuê/tháng"
                                allowDecimal
                                value={type.referenceRent ?? ''}
                                onValueChange={(raw) =>
                                  updateType(type.key, {
                                    referenceRent: raw === '' ? null : exactRent(raw),
                                  })
                                }
                              />
                            </Box>
                          ))}
                        </Box>
                        <Divider />
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
                      selected={draft.rules.flatMap((rule) =>
                        rule.sourceId ? [rule.sourceId] : [],
                      )}
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
                      'Loại có định mức',
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
                    Loại phòng và định mức
                  </Typography>
                  <Button onClick={() => changeStep(1)}>Sửa loại phòng</Button>
                </Stack>
                <TableContainer component={Paper} variant="outlined">
                  <Table
                    size="small"
                    aria-label="Loại phòng và định mức xác nhận"
                    sx={{ minWidth: 650 }}
                  >
                    <TableHead>
                      <TableRow>
                        <TableCell>Loại phòng</TableCell>
                        <TableCell>Sức chứa / diện tích</TableCell>
                        <TableCell>Giá mặc định</TableCell>
                        <TableCell>Phòng</TableCell>
                        <TableCell>Định mức</TableCell>
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
                            {type.assets
                              .map((asset) => `${asset.name} × ${asset.quantity}`)
                              .join(', ') || 'Không có'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
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
                {draft.packages.length > 0 && (
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography sx={{ fontWeight: 700 }}>Đối chiếu gói tài sản đã nạp</Typography>
                    {draft.packages.map((item) => (
                      <Typography key={item.id} variant="body2">
                        {item.name}:{' '}
                        {item.discarded
                          ? 'Không sử dụng'
                          : draft.roomTypes
                              .filter((type) => item.assignedTypeKeys?.includes(type.key))
                              .map((type) => type.name)
                              .join(', ') || 'Chưa gán'}
                      </Typography>
                    ))}
                  </Paper>
                )}
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
          <Button onClick={() => changeStep(draft.step - 1)} disabled={busy || draft.step === 0}>
            Quay lại
          </Button>
          <Box sx={{ display: { xs: 'none', sm: 'block' } }} />
          <Button color="secondary" onClick={reset} disabled={busy}>
            Xóa nháp
          </Button>
          <Button variant="outlined" onClick={onClose} disabled={busy}>
            Lưu nháp & đóng
          </Button>
          {draft.step < 6 ? (
            <Button
              variant="contained"
              onClick={() => changeStep(draft.step + 1)}
              disabled={busy}
              sx={{ whiteSpace: 'normal' }}
            >
              Tiếp tục ({steps[draft.step + 1]})
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
                    label="Giá thuê mặc định (VND/tháng)"
                    allowDecimal
                    value={editingType.referenceRent ?? ''}
                    onValueChange={(raw) =>
                      setEditingType({
                        ...editingType,
                        referenceRent: raw === '' ? null : exactRent(raw),
                      })
                    }
                  />
                  <TextField
                    label="Tiện nghi (phân tách bằng dấu phẩy)"
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
