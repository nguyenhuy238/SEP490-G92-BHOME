import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
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
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { Building2, Copy, Plus, Sparkles, Trash2 } from 'lucide-react';
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
  AssetTemplateData,
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
import { formatBillingDecimal } from '../../../../../../packages/client-core/src/invoices';

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
  'asset-templates',
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
    return 'Định mức tài sản phải có số lượng nguyên dương.';
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
  const [assetPackage, setAssetPackage] = useState('');

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
      if (!committed.current) sessionStorage.setItem(storageKey, JSON.stringify(draft));
    } catch {
      /* storage may be disabled */
    }
  }, [draft, storageKey]);

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
    refetchOnMount: 'always',
    refetchOnWindowFocus: 'always',
  });
  const source = useQuery({
    queryKey: ['location-setup-source', session?.userId, draft.sourceLocationId],
    queryFn: ({ signal }) => api.source(draft.sourceLocationId, signal),
    enabled: draft.mode === 'copy' && !!draft.sourceLocationId,
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
            resources: ['asset-catalog', 'asset-templates'] as SharedResource[],
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
  const addAsset = (id: string) => {
    if (!assetType) return;
    const item = all('asset-catalog').find((document) => document.id === id);
    if (!item) return;
    const data = item.data as AssetCatalogData;
    const found = assetType.assets.find(
      (asset) =>
        norm(asset.name) === norm(item.name) && norm(asset.category) === norm(data.category),
    );
    const imported = reference('asset-catalog', item);
    updateType(assetType.key, {
      assets: found
        ? assetType.assets.map((asset) =>
            asset === found
              ? {
                  ...asset,
                  quantity: asset.quantity + 1,
                  references: uniqueReferences([...(asset.references ?? []), imported]),
                }
              : asset,
          )
        : [
            ...assetType.assets,
            {
              name: item.name,
              category: data.category,
              quantity: 1,
              trackingMode: 'BulkQuantity',
              references: [imported],
            },
          ],
    });
  };
  const incompletePackages = all('asset-templates').filter((document) =>
    (document.data as AssetTemplateData).items.some((item) => !item.catalog),
  );
  const packages: ImportedPackage[] = [
    ...draft.packages,
    ...all('asset-templates')
      .filter((document) => !incompletePackages.includes(document))
      .map((document) => ({
        id: document.id,
        name: document.name,
        reference: reference('asset-templates', document),
        items: (document.data as AssetTemplateData).items.map((item) => ({
          name: item.catalog!.name,
          category: item.catalog!.category,
          quantity: item.quantity,
          trackingMode: item.trackingMode,
        })),
      })),
  ];
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
  const applyPackage = () => {
    const selected = packages.find((item) => item.id === assetPackage);
    if (selected) applyPackageTo(selected);
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
          detail: `${doc.data.defaults.capacity} người · ${money(doc.data.defaults.referenceRent === null ? null : exactRent(doc.data.defaults.referenceRent))}`,
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
          detail: `${money(fee.rate)} · ${fee.roomId ? 'Cần ánh xạ phòng đích' : 'Cấp cơ sở'}`,
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
    if (!confirmSave || lock.current) return;
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
        e instanceof Error
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

  return (
    <>
      <Dialog open fullWidth maxWidth="xl" onClose={busy ? undefined : onClose}>
        <DialogTitle>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Building2 size={24} />
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                Thiết lập cấu hình cơ sở ban đầu
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Cấu hình một lần, quản lý và vận hành bằng dữ liệu thật.
              </Typography>
            </Box>
          </Stack>
        </DialogTitle>
        <Box sx={{ px: 3, py: 1.5, bgcolor: 'background.default' }}>
          <Stepper activeStep={draft.step} alternativeLabel nonLinear>
            {steps.map((label, index) => (
              <Step key={label} completed={index < draft.step}>
                <StepButton onClick={() => changeStep(index)} disabled={busy}>
                  {label}
                </StepButton>
              </Step>
            ))}
          </Stepper>
        </Box>
        <DialogContent
          dividers
          inert={busy}
          aria-busy={busy}
          sx={{ minHeight: 440, maxHeight: '70vh' }}
        >
          <Stack spacing={2.5}>
            {busy && <LinearProgress />}
            {librarySection && (
              <Alert
                severity="info"
                action={
                  <Stack direction="row" spacing={1}>
                    <Button disabled={library.isFetching} onClick={() => void library.refetch()}>
                      Làm mới mẫu
                    </Button>
                    <Button
                      component="a"
                      href={librarySection.path}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Mở thư viện mẫu
                    </Button>
                  </Stack>
                }
              >
                {library.isFetching
                  ? 'Đang tải thư viện mẫu…'
                  : `Có ${unpublished(librarySection.resources).length} mẫu chưa công bố trong nhóm này. Mẫu đã công bố có thể chọn ngay. Bạn có thể mở thư viện để tạo hoặc công bố mẫu, rồi quay lại làm mới; bản nháp cơ sở được giữ nguyên.`}
                {!library.isFetching &&
                  unpublished(librarySection.resources).map((doc) => (
                    <Typography key={doc.id} variant="body2">
                      {doc.name} · Bản nháp, cần công bố
                    </Typography>
                  ))}
              </Alert>
            )}
            {error && (
              <Alert severity="error" onClose={() => setError('')}>
                {error}
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
                <Typography variant="h6">1. Phương thức thiết lập và thông tin cơ sở</Typography>
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
                          p: 2,
                          borderColor: draft.mode === mode ? 'primary.main' : 'divider',
                          bgcolor: draft.mode === mode ? 'action.selected' : 'background.paper',
                        }}
                      >
                        <Button
                          fullWidth
                          variant="text"
                          startIcon={mode === 'copy' ? <Copy size={18} /> : <Building2 size={18} />}
                          disabled={!!draft.appliedSource && mode !== draft.mode}
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
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Stack spacing={2}>
                      <Alert severity="info">
                        Chỉ nạp cấu hình. Không sao chép phòng thực tế, tài sản đã kiểm kê, khách
                        thuê, hợp đồng, hóa đơn, thanh toán hoặc chi phí.
                      </Alert>
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
                                <Paper variant="outlined" sx={{ p: 1.5 }}>
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
                                        label="Chọn tất cả"
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
                                </Paper>
                              </Grid>
                            ))}
                          </Grid>
                          <Button
                            variant="contained"
                            onClick={applyCopy}
                            disabled={!copySelection.length}
                          >
                            Nạp cấu hình đã chọn ({copySelection.length})
                          </Button>
                          <Typography variant="caption" color="text.secondary">
                            Giá thuê mặc định đi cùng loại phòng. Giá riêng và biểu phí theo phòng
                            nguồn không được gắn sang phòng khác nếu chưa chọn ánh xạ.
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
                  sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <Box>
                    <Typography variant="h6">2. Loại phòng của cơ sở</Typography>
                    <Typography variant="body2" color="text.secondary">
                      Chọn hoặc kéo thả mẫu; thay đổi chỉ áp dụng tại cơ sở này.
                    </Typography>
                    {draft.sourceRent !== null && (
                      <Typography variant="caption">
                        Giá thuê tham khảo từ cơ sở nguồn: {money(draft.sourceRent)}/tháng. Kiểm tra
                        và xác nhận cho từng loại phòng.
                      </Typography>
                    )}
                  </Box>
                  <Button
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
                          <Paper key={type.key} variant="outlined" sx={{ p: 2 }}>
                            <Stack spacing={1}>
                              <Stack
                                direction="row"
                                sx={{ justifyContent: 'space-between', alignItems: 'center' }}
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
                              <Stack direction="row" spacing={1}>
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
                          <Alert severity="info">Kéo mẫu vào đây hoặc bấm Thêm loại phòng.</Alert>
                        )}
                      </Stack>
                    </SetupDropZone>
                  </Grid>
                </Grid>
              </>
            )}
            {draft.step === 2 && (
              <>
                <Typography variant="h6">3. Sinh phòng hàng loạt</Typography>
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
                  <Table size="small">
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
                <Typography variant="h6">4. Định mức tài sản & tiện nghi</Typography>
                <Alert severity="info">
                  Định mức là trang bị dự kiến cho từng loại phòng. Chưa tạo tài sản vật lý hoặc chi
                  phí mua sắm cho tới khi xác minh thực tế.
                </Alert>
                {draft.packages.length > 0 && (
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Stack spacing={1}>
                      <Typography sx={{ fontWeight: 700 }}>
                        Gói tài sản đã sao chép – xác nhận sử dụng
                      </Typography>
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
                            onClick={() => {
                              setAssetPackage(item.id);
                              applyPackageTo(item);
                            }}
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
                {incompletePackages.length > 0 && (
                  <Alert severity="warning">
                    Không thể nạp các gói thiếu dữ liệu danh mục:{' '}
                    {incompletePackages.map((item) => item.name).join(', ')}. Hãy kiểm tra lại thư
                    viện.
                  </Alert>
                )}
                <TextField
                  select
                  label="Loại phòng đang cấu hình"
                  value={assetType?.key ?? ''}
                  onChange={(e) => {
                    setAssetTypeKey(e.target.value);
                    setAssetPackage('');
                  }}
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
                      kind="asset"
                      add={addAsset}
                      items={all('asset-catalog').map((doc) => ({
                        id: doc.id,
                        name: doc.name,
                        detail: (doc.data as AssetCatalogData).category,
                      }))}
                    >
                      <Stack direction="row" spacing={1}>
                        <TextField
                          select
                          fullWidth
                          size="small"
                          label="Gói tài sản"
                          value={assetPackage}
                          onChange={(e) => setAssetPackage(e.target.value)}
                        >
                          <MenuItem value="">Chọn gói</MenuItem>
                          {packages
                            .filter((item) => !item.discarded)
                            .map((item) => (
                              <MenuItem key={item.id} value={item.id}>
                                {item.name}
                              </MenuItem>
                            ))}
                        </TextField>
                        <Button disabled={!assetPackage || !assetType} onClick={applyPackage}>
                          Nạp
                        </Button>
                      </Stack>
                    </SetupTemplatePicker>
                  </Grid>
                  <Grid size={{ xs: 12, md: 7 }}>
                    <SetupDropZone kind="asset" add={addAsset}>
                      <Stack spacing={1.5}>
                        <Stack
                          direction="row"
                          sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                        >
                          <Typography sx={{ fontWeight: 700 }}>
                            {assetType?.name ?? 'Chưa chọn loại phòng'} –{' '}
                            {assetType?.assets.length ?? 0} mục
                          </Typography>
                          <Button
                            disabled={!assetType}
                            onClick={() =>
                              assetType &&
                              updateType(assetType.key, {
                                assets: [
                                  ...assetType.assets,
                                  {
                                    name: '',
                                    category: '',
                                    quantity: 1,
                                    trackingMode: 'BulkQuantity',
                                  },
                                ],
                              })
                            }
                          >
                            Thêm riêng
                          </Button>
                        </Stack>
                        {assetType?.assets.map((asset, index) => (
                          <Paper variant="outlined" key={index} sx={{ p: 1.5 }}>
                            <Stack
                              direction={{ xs: 'column', md: 'row' }}
                              spacing={1}
                              sx={{ alignItems: { md: 'center' } }}
                            >
                              <Stack spacing={1} sx={{ flex: 1 }}>
                                <TextField
                                  size="small"
                                  label="Tên tài sản"
                                  value={asset.name}
                                  onChange={(e) =>
                                    updateType(assetType.key, {
                                      assets: assetType.assets.map((value, i) =>
                                        i === index ? { ...value, name: e.target.value } : value,
                                      ),
                                    })
                                  }
                                />
                                <TextField
                                  size="small"
                                  label="Nhóm tài sản"
                                  value={asset.category}
                                  onChange={(e) =>
                                    updateType(assetType.key, {
                                      assets: assetType.assets.map((value, i) =>
                                        i === index
                                          ? { ...value, category: e.target.value }
                                          : value,
                                      ),
                                    })
                                  }
                                />
                              </Stack>
                              <TextField
                                size="small"
                                type="number"
                                label="Số lượng"
                                value={asset.quantity}
                                onChange={(e) =>
                                  updateType(assetType.key, {
                                    assets: assetType.assets.map((value, i) =>
                                      i === index
                                        ? { ...value, quantity: Number(e.target.value) }
                                        : value,
                                    ),
                                  })
                                }
                                sx={{ width: 110 }}
                              />
                              <TextField
                                size="small"
                                select
                                label="Theo dõi"
                                value={asset.trackingMode}
                                onChange={(e) =>
                                  updateType(assetType.key, {
                                    assets: assetType.assets.map((value, i) =>
                                      i === index
                                        ? {
                                            ...value,
                                            trackingMode: e.target
                                              .value as SetupAssetRequirement['trackingMode'],
                                          }
                                        : value,
                                    ),
                                  })
                                }
                              >
                                <MenuItem value="BulkQuantity">Số lượng</MenuItem>
                                <MenuItem value="Serialized">Mã riêng/serial</MenuItem>
                              </TextField>
                              <Button
                                color="error"
                                aria-label={`Bỏ ${asset.name}`}
                                onClick={() =>
                                  updateType(assetType.key, {
                                    assets: assetType.assets.filter((_, i) => i !== index),
                                  })
                                }
                              >
                                <Trash2 size={16} />
                              </Button>
                            </Stack>
                          </Paper>
                        ))}
                        {!assetType?.assets.length && (
                          <Typography variant="body2" color="text.secondary">
                            Kéo thả, bấm Thêm tài sản từ danh mục hoặc thêm định mức riêng.
                          </Typography>
                        )}
                        <Typography variant="caption" color="text.secondary">
                          Áp dụng cho{' '}
                          {draft.rooms.filter((room) => room.roomTypeKey === assetType?.key).length}{' '}
                          phòng thuộc loại này.
                        </Typography>
                      </Stack>
                    </SetupDropZone>
                  </Grid>
                </Grid>
              </>
            )}
            {draft.step === 4 && (
              <>
                <Typography variant="h6">5. Giá thuê và biểu phí</Typography>
                <Alert severity="info">
                  Xác nhận giá thực tế theo phòng hoặc cơ sở. Biểu phí theo phòng nguồn phải chọn
                  phòng đích. Các mức giá trong thư viện chỉ là tham khảo.
                </Alert>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <SetupTemplatePicker
                      title="Mẫu giá & biểu phí"
                      kind="fee"
                      add={addFee}
                      selected={draft.fees.flatMap((fee) => (fee.sourceId ? [fee.sourceId] : []))}
                      items={all('fee-templates').map((doc) => {
                        const data = doc.data as FeeTemplateData;
                        return {
                          id: doc.id,
                          name: doc.name,
                          detail: `${money(data.referenceRate)}/${feeUnitLabel(categoryNumber(data.category), methodNumber(data.method))} · ${data.scope}`,
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
                        {draft.roomTypes.map((type) => (
                          <Stack
                            key={type.key}
                            direction="row"
                            spacing={2}
                            sx={{ alignItems: 'center' }}
                          >
                            <Typography sx={{ flex: 1 }}>{type.name}</Typography>
                            <MoneyField
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
                          </Stack>
                        ))}
                        <Divider />
                        <Stack
                          direction="row"
                          sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                        >
                          <Typography sx={{ fontWeight: 700 }}>
                            Biểu phí dịch vụ ({draft.fees.length})
                          </Typography>
                          <Button
                            startIcon={<Plus size={16} />}
                            onClick={() => patch({ fees: [...draft.fees, newFee()] })}
                          >
                            Thêm khoản phí
                          </Button>
                        </Stack>
                        {draft.fees.map((fee) => (
                          <Paper variant="outlined" key={fee.key} sx={{ p: 1.5 }}>
                            <Grid container spacing={1.5}>
                              <Grid size={{ xs: 12, md: 6 }}>
                                <TextField
                                  fullWidth
                                  size="small"
                                  label="Tên khoản thu"
                                  value={fee.name}
                                  onChange={(e) => updateFee(fee.key, { name: e.target.value })}
                                />
                              </Grid>
                              <Grid size={{ xs: 12, md: 6 }}>
                                <TextField
                                  fullWidth
                                  size="small"
                                  label="Mã khoản thu"
                                  value={fee.chargeCode}
                                  disabled={fee.category !== 3}
                                  onChange={(e) =>
                                    updateFee(fee.key, { chargeCode: e.target.value.toUpperCase() })
                                  }
                                />
                              </Grid>
                              <Grid size={{ xs: 6, md: 4 }}>
                                <TextField
                                  fullWidth
                                  select
                                  size="small"
                                  label="Loại khoản thu"
                                  value={fee.category}
                                  onChange={(e) => {
                                    const category = Number(e.target.value) as SetupFee['category'];
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
                              <Grid size={{ xs: 6, md: 4 }}>
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
                              <Grid size={{ xs: 12, md: 4 }}>
                                <MoneyField
                                  fullWidth
                                  size="small"
                                  label={`Đơn giá (VND/${feeUnitLabel(fee.category, fee.method)})`}
                                  value={fee.rate}
                                  allowDecimal
                                  onValueChange={(raw) => updateFee(fee.key, { rate: raw })}
                                />
                              </Grid>
                              <Grid size={{ xs: 12, md: 4 }}>
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
                              <Grid size={{ xs: 6, md: 4 }}>
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
                              <Grid size={{ xs: 6, md: 4 }}>
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
                          </Paper>
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
              </>
            )}
            {draft.step === 5 && (
              <>
                <Typography variant="h6">6. Nội quy cơ sở</Typography>
                <Alert severity="info">
                  Các điều khoản được hợp nhất thành một nội quy có phiên bản để hợp đồng sử dụng
                  đúng bản đã công bố. Có thể xem lại và chỉnh nội dung trước khi xác nhận.
                </Alert>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, md: 5 }}>
                    <SetupTemplatePicker
                      title="Mẫu nội quy"
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
                  <Grid size={{ xs: 12, md: 7 }}>
                    <SetupDropZone kind="rule" add={addRule}>
                      <Stack spacing={2}>
                        <Stack
                          direction="row"
                          sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                        >
                          <Typography sx={{ fontWeight: 700 }}>
                            Các điều khoản ({draft.rules.length})
                          </Typography>
                          <Button
                            startIcon={<Plus size={16} />}
                            onClick={() =>
                              patch({
                                rules: [...draft.rules, { key: uid(), title: '', content: '' }],
                              })
                            }
                          >
                            Thêm riêng
                          </Button>
                        </Stack>
                        <TextField
                          label="Tên nội quy công bố"
                          value={draft.policyTitle}
                          onChange={(e) => patch({ policyTitle: e.target.value })}
                        />
                        <TextField
                          type="date"
                          label="Ngày hiệu lực nội quy"
                          value={draft.policyDate}
                          onChange={(e) => patch({ policyDate: e.target.value })}
                          slotProps={{ inputLabel: { shrink: true } }}
                        />
                        {draft.rules.map((rule) => (
                          <Paper variant="outlined" key={rule.key} sx={{ p: 1.5 }}>
                            <Stack spacing={1}>
                              <TextField
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
                              <Button
                                size="small"
                                color="error"
                                onClick={() =>
                                  patch({
                                    rules: draft.rules.filter((item) => item.key !== rule.key),
                                  })
                                }
                              >
                                Bỏ điều khoản
                              </Button>
                            </Stack>
                          </Paper>
                        ))}
                        {!draft.rules.length && (
                          <Typography color="text.secondary">
                            Có thể bổ sung nội quy sau khi lưu cơ sở.
                          </Typography>
                        )}
                      </Stack>
                    </SetupDropZone>
                  </Grid>
                </Grid>
              </>
            )}
            {draft.step === 6 && (
              <>
                <Typography variant="h6">7. Xem lại và hoàn tất</Typography>
                <Alert severity="info">
                  Xác nhận sẽ ghi toàn bộ dữ liệu bằng một yêu cầu backend. Nếu có lỗi, bản nháp vẫn
                  được giữ. Không tạo khách thuê, hợp đồng, hóa đơn, thanh toán hoặc tài sản vật lý.
                </Alert>
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
                    Giá thuê từng phòng có hiệu lực từ {draft.rentEffectiveFrom}.
                  </Typography>
                </Paper>
                <Grid container spacing={2}>
                  {[
                    ['Loại phòng', draft.roomTypes.length],
                    ['Phòng', draft.rooms.length],
                    [
                      'Loại có định mức',
                      draft.roomTypes.filter((type) => type.assets.length).length,
                    ],
                    ['Biểu phí dịch vụ', draft.fees.length],
                    ['Điều khoản nội quy', draft.rules.length],
                  ].map(([label, count]) => (
                    <Grid key={label} size={{ xs: 6, md: 2.4 }}>
                      <Paper variant="outlined" sx={{ p: 2 }}>
                        <Typography color="text.secondary" variant="body2">
                          {label}
                        </Typography>
                        <Typography variant="h5" sx={{ fontWeight: 800 }}>
                          {count}
                        </Typography>
                      </Paper>
                    </Grid>
                  ))}
                </Grid>
                <TableContainer component={Paper} variant="outlined">
                  <Table size="small">
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
                          <TableCell>{money(type.referenceRent)}</TableCell>
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
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography sx={{ fontWeight: 700 }}>
                    Giá thuê thực tế từng phòng · hiệu lực {draft.rentEffectiveFrom}
                  </Typography>
                  {draft.rooms.map((room) => (
                    <Typography key={room.key} variant="body2">
                      {room.roomNumber} ·{' '}
                      {money(
                        room.rent ??
                          draft.roomTypes.find((type) => type.key === room.roomTypeKey)
                            ?.referenceRent ??
                          null,
                      )}
                      /tháng
                    </Typography>
                  ))}
                </Paper>
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
                        · từ {fee.effectiveFrom}
                      </Typography>
                    ))}
                  </Paper>
                )}
                {draft.rules.length > 0 && (
                  <Paper variant="outlined" sx={{ p: 2 }}>
                    <Typography sx={{ fontWeight: 700 }}>
                      {draft.policyTitle} – công bố từ {draft.policyDate}
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
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button onClick={() => changeStep(draft.step - 1)} disabled={busy || draft.step === 0}>
            Quay lại
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button color="secondary" onClick={reset} disabled={busy}>
            Xóa nháp
          </Button>
          <Button variant="outlined" onClick={onClose} disabled={busy}>
            Lưu nháp & đóng
          </Button>
          {draft.step < 6 ? (
            <Button variant="contained" onClick={() => changeStep(draft.step + 1)} disabled={busy}>
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
