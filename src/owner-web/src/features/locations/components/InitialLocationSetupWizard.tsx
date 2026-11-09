import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  FormControlLabel,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Radio,
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
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeDollarSign,
  Building2,
  CheckCircle2,
  Copy,
  Edit2,
  Layers3,
  Package,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { makeRecord } from '../../../services/mock/seed';
import type { DemoDatabase, PortalRecord } from '../../../types/portal';
import {
  INITIAL_ASSET_CATALOG,
  INITIAL_FEE_POLICIES,
  INITIAL_HOUSE_RULES,
  INITIAL_ROOM_TYPE_REQUIREMENTS,
  INITIAL_ROOM_TYPES,
} from '../mock/locationConfigMock';
import type {
  AssetCatalogItem,
  FeePolicyItem,
  GeneratedRoomDraft,
  HouseRuleItem,
  RoomAssetAssignmentDraft,
  RoomTypeDraft,
} from '../types/locationConfig';
import type {
  AssetCatalogData,
  FeeTemplateData,
  PolicyTemplateData,
  RoomTemplateData,
} from '../../../../../../packages/client-core/src/sharedConfiguration';
import { useSharedConfigurationApi } from '../../configuration/useSharedConfigurationApi';
import { isMockMode } from '../../../services/config';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';

type WizardCopyGroup = 'ROOM_TYPES' | 'ROOMS' | 'ASSETS' | 'RENT' | 'FEES' | 'RULES';
const WIZARD_DRAFT_KEY = 'bhome-owner-location-setup-draft-v1';

export interface InitialLocationSetupResult {
  roomTypes: RoomTypeDraft[];
  rooms: GeneratedRoomDraft[];
  feePolicies: FeePolicyItem[];
  houseRules: HouseRuleItem[];
  rateOverrides: Record<string, number>;
  roomAssetAssignments: RoomAssetAssignmentDraft[];
  assetCatalog: AssetCatalogItem[];
  roomTypeTemplates: Record<
    string,
    { catalogId: string; quantity: number; isMandatory: boolean }[]
  >;
}

interface InitialLocationSetupWizardProps {
  open: boolean;
  onClose: () => void;
  db: DemoDatabase;
  onComplete: (
    newLocationRecord: PortalRecord,
    wizardData: InitialLocationSetupResult,
  ) => void | boolean | Promise<void | boolean>;
}

const WIZARD_STEPS = [
  'Thông tin cơ sở',
  'Loại phòng',
  'Tạo phòng',
  'Tài sản & Tiện nghi',
  'Giá thuê phòng',
  'Biểu phí dịch vụ',
  'Nội quy cơ sở',
  'Xem lại & Hoàn tất',
];

export function InitialLocationSetupWizard({
  open,
  onClose,
  db,
  onComplete,
}: InitialLocationSetupWizardProps) {
  const sharedApi = useSharedConfigurationApi();
  const setupApi = usePropertySetupApi();
  const [activeStep, setActiveStep] = useState(0);

  // Step 1: Setup Mode & Location Information
  const [setupMode, setSetupMode] = useState<'SCRATCH' | 'COPY'>('SCRATCH');
  const [sourceLocationId, setSourceLocationId] = useState(db.records.locations[0]?.id || '');
  const [copyGroups, setCopyGroups] = useState<WizardCopyGroup[]>([
    'ROOM_TYPES',
    'ROOMS',
    'ASSETS',
    'RENT',
    'FEES',
    'RULES',
  ]);
  const [isLoadingCopy, setIsLoadingCopy] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [copyLoaded, setCopyLoaded] = useState(false);
  const [locationName, setLocationName] = useState('BHOME Sky View - Nguyễn Thị Thập');
  const [locationCode, setLocationCode] = useState('CS-04');
  const [address, setAddress] = useState('250 Nguyễn Thị Thập, P. Tân Quy, Quận 7, TP.HCM');
  const [floors, setFloors] = useState<number>(4);
  const [contactPhone, setContactPhone] = useState('0908 123 456');
  const [contactEmail, setContactEmail] = useState('contact.skyview@bhome.vn');
  const [description, setDescription] = useState(
    'Cơ sở thông minh với thang máy thẻ từ, khóa vân tay và sân thượng chill',
  );
  const [operationalStatus, setOperationalStatus] = useState<'ACTIVE' | 'PREPARING'>('PREPARING');

  // Step 2: Room Types
  const [roomTypes, setRoomTypes] = useState<RoomTypeDraft[]>(isMockMode ? INITIAL_ROOM_TYPES : []);
  const [editingRoomType, setEditingRoomType] = useState<RoomTypeDraft | null>(null);

  // Step 3: Rooms
  const [rooms, setRooms] = useState<GeneratedRoomDraft[]>(
    isMockMode
      ? [
          { code: 'P.101', floor: 1, roomTypeId: 'type-studio', status: 'AVAILABLE' },
          { code: 'P.102', floor: 1, roomTypeId: 'type-studio', status: 'AVAILABLE' },
          { code: 'P.201', floor: 2, roomTypeId: 'type-mezzanine', status: 'AVAILABLE' },
          { code: 'P.202', floor: 2, roomTypeId: 'type-mezzanine', status: 'AVAILABLE' },
          { code: 'P.301', floor: 3, roomTypeId: 'type-1br', status: 'AVAILABLE' },
          { code: 'P.302', floor: 3, roomTypeId: 'type-1br', status: 'AVAILABLE' },
        ]
      : [],
  );
  const [editingRoom, setEditingRoom] = useState<GeneratedRoomDraft | null>(null);
  const [editingRoomOriginalCode, setEditingRoomOriginalCode] = useState('');
  // Bulk room generator state
  const [bulkFloor, setBulkFloor] = useState<number>(2);
  const [bulkRoomTypeId, setBulkRoomTypeId] = useState<string>('type-studio');
  const [bulkPrefix, setBulkPrefix] = useState<string>('P.');
  const [bulkQuantity, setBulkQuantity] = useState<number>(4);

  // Step 4: Asset Configuration
  const [assetCatalog, setAssetCatalog] = useState<AssetCatalogItem[]>(
    isMockMode ? INITIAL_ASSET_CATALOG : [],
  );
  const [roomTypeTemplates, setRoomTypeTemplates] = useState<
    Record<string, { catalogId: string; quantity: number; isMandatory: boolean }[]>
  >(isMockMode ? INITIAL_ROOM_TYPE_REQUIREMENTS : {});
  const [selectedTemplateRoomType, setSelectedTemplateRoomType] = useState<string>('type-studio');
  const [roomAssetAssignments, setRoomAssetAssignments] = useState<RoomAssetAssignmentDraft[]>([]);
  const [finishError, setFinishError] = useState('');
  const [isFinishing, setIsFinishing] = useState(false);
  const [templateAppliedNotice, setTemplateAppliedNotice] = useState<string | null>(null);

  // Step 5: Rental Rates
  const [rateOverrides, setRateOverrides] = useState<Record<string, number>>({});

  // Step 6: Fee Policies
  const [feePolicies, setFeePolicies] = useState<FeePolicyItem[]>(
    isMockMode ? INITIAL_FEE_POLICIES : [],
  );
  const [editingFee, setEditingFee] = useState<FeePolicyItem | null>(null);
  const [previewKwh, setPreviewKwh] = useState<number>(150);
  const [previewM3, setPreviewM3] = useState<number>(12);
  const [previewRoomTypeId, setPreviewRoomTypeId] = useState<string>('');

  // Step 7: House Rules
  const [houseRules, setHouseRules] = useState<HouseRuleItem[]>(
    isMockMode ? INITIAL_HOUSE_RULES : [],
  );
  const [editingRule, setEditingRule] = useState<HouseRuleItem | null>(null);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [libraryError, setLibraryError] = useState('');
  const [draftRestored, setDraftRestored] = useState(false);

  const previewRoomType =
    roomTypes.find((roomType) => roomType.id === previewRoomTypeId) ?? roomTypes[0];
  const previewRent = previewRoomType?.defaultRate ?? 0;
  const previewFeeAmount = (fee: FeePolicyItem) => {
    if (fee.calculationMethod === 'PER_KWH') return previewKwh * fee.unitPrice;
    if (fee.calculationMethod === 'PER_M3') return previewM3 * fee.unitPrice;
    return fee.unitPrice;
  };
  const previewFeesTotal = feePolicies.reduce((total, fee) => total + previewFeeAmount(fee), 0);
  const assignedAssetCatalogIds = [
    ...new Set(
      Object.values(roomTypeTemplates).flatMap((items) => items.map((item) => item.catalogId)),
    ),
  ];
  const assignedAssetNames = assignedAssetCatalogIds.map(
    (id) => assetCatalog.find((item) => item.id === id)?.name ?? id,
  );

  useEffect(() => {
    if (!open || draftRestored) return;
    try {
      const raw = sessionStorage.getItem(WIZARD_DRAFT_KEY);
      if (raw) {
        const draft = JSON.parse(raw) as Partial<{
          activeStep: number;
          setupMode: 'SCRATCH' | 'COPY';
          sourceLocationId: string;
          copyGroups: WizardCopyGroup[];
          locationName: string;
          locationCode: string;
          address: string;
          floors: number;
          contactPhone: string;
          contactEmail: string;
          description: string;
          operationalStatus: 'ACTIVE' | 'PREPARING';
          roomTypes: RoomTypeDraft[];
          rooms: GeneratedRoomDraft[];
          assetCatalog: AssetCatalogItem[];
          roomTypeTemplates: Record<
            string,
            { catalogId: string; quantity: number; isMandatory: boolean }[]
          >;
          feePolicies: FeePolicyItem[];
          houseRules: HouseRuleItem[];
          rateOverrides: Record<string, number>;
        }>;
        if (draft.activeStep !== undefined) setActiveStep(draft.activeStep);
        if (draft.setupMode) setSetupMode(draft.setupMode);
        if (draft.sourceLocationId) setSourceLocationId(draft.sourceLocationId);
        if (draft.copyGroups) setCopyGroups(draft.copyGroups);
        if (draft.locationName !== undefined) setLocationName(draft.locationName);
        if (draft.locationCode !== undefined) setLocationCode(draft.locationCode);
        if (draft.address !== undefined) setAddress(draft.address);
        if (draft.floors !== undefined) setFloors(draft.floors);
        if (draft.contactPhone !== undefined) setContactPhone(draft.contactPhone);
        if (draft.contactEmail !== undefined) setContactEmail(draft.contactEmail);
        if (draft.description !== undefined) setDescription(draft.description);
        if (draft.operationalStatus) setOperationalStatus(draft.operationalStatus);
        if (draft.roomTypes) setRoomTypes(draft.roomTypes);
        if (draft.rooms) setRooms(draft.rooms);
        if (draft.assetCatalog) setAssetCatalog(draft.assetCatalog);
        if (draft.roomTypeTemplates) setRoomTypeTemplates(draft.roomTypeTemplates);
        if (draft.feePolicies) setFeePolicies(draft.feePolicies);
        if (draft.houseRules) setHouseRules(draft.houseRules);
        if (draft.rateOverrides) setRateOverrides(draft.rateOverrides);
      }
    } finally {
      setDraftRestored(true);
    }
  }, [draftRestored, open]);

  useEffect(() => {
    if (!open || !draftRestored) return;
    sessionStorage.setItem(
      WIZARD_DRAFT_KEY,
      JSON.stringify({
        activeStep,
        setupMode,
        sourceLocationId,
        copyGroups,
        locationName,
        locationCode,
        address,
        floors,
        contactPhone,
        contactEmail,
        description,
        operationalStatus,
        roomTypes,
        rooms,
        assetCatalog,
        roomTypeTemplates,
        feePolicies,
        houseRules,
        rateOverrides,
      }),
    );
  }, [
    activeStep,
    address,
    assetCatalog,
    contactEmail,
    contactPhone,
    copyGroups,
    description,
    draftRestored,
    feePolicies,
    floors,
    houseRules,
    locationCode,
    locationName,
    open,
    operationalStatus,
    rateOverrides,
    roomTypeTemplates,
    roomTypes,
    rooms,
    setupMode,
    sourceLocationId,
  ]);

  const loadSharedLibrary = async () => {
    setIsLoadingLibrary(true);
    setLibraryError('');
    try {
      const [roomPage, assetPage, feePage, policyPage] = await Promise.all([
        sharedApi.list('room-type-templates', '', '', 1, 100),
        sharedApi.list('asset-catalog', '', '', 1, 100),
        sharedApi.list('fee-templates', '', '', 1, 100),
        sharedApi.list('policy-templates', '', '', 1, 100),
      ]);
      const available = <T extends { status: string }>(items: T[]) =>
        items.filter((item) => item.status !== 'Archived');
      const loadedRoomTypes = available(roomPage.items).map((document) => {
        const data = document.data as RoomTemplateData;
        return {
          id: document.id,
          name: document.name,
          code: `RT-${document.familyId.slice(0, 6).toUpperCase()}`,
          area: Number(data.area),
          maxOccupants: data.capacity,
          defaultRate: Number(data.referenceRent ?? 0),
          description: document.description,
          facilities: data.amenities,
          status: 'ACTIVE' as const,
        };
      });
      setRooms((currentRooms) =>
        currentRooms.map((room) => {
          if (loadedRoomTypes.some((roomType) => roomType.id === room.roomTypeId)) return room;
          const previousName = roomTypes.find((roomType) => roomType.id === room.roomTypeId)?.name;
          const replacement = loadedRoomTypes.find(
            (roomType) =>
              roomType.name.trim().toLocaleLowerCase() === previousName?.trim().toLocaleLowerCase(),
          );
          return replacement ? { ...room, roomTypeId: replacement.id } : room;
        }),
      );
      setRoomTypes(loadedRoomTypes);
      setSelectedTemplateRoomType(loadedRoomTypes[0]?.id ?? '');
      setBulkRoomTypeId(loadedRoomTypes[0]?.id ?? '');
      setRoomTypeTemplates({});
      setAssetCatalog(
        available(assetPage.items).map((document) => {
          const data = document.data as AssetCatalogData;
          return {
            id: document.id,
            name: document.name,
            category: data.category as AssetCatalogItem['category'],
            defaultCost: Number(data.referencePrice),
            iconName: 'Package',
            description: document.description,
          };
        }),
      );
      setFeePolicies(
        available(feePage.items).map((document) => {
          const data = document.data as FeeTemplateData;
          const category = data.category.toUpperCase();
          return {
            id: document.id,
            name: document.name,
            chargeCode: data.chargeCode,
            type:
              category === 'ELECTRICITY' ? 'ELECTRICITY' : category === 'WATER' ? 'WATER' : 'OTHER',
            calculationMethod: data.method.toUpperCase() === 'METERED' ? 'PER_KWH' : 'FIXED_AMOUNT',
            unitPrice: Number(data.referenceRate),
            unit: data.unit,
            applicationScope: data.scope === 'Room' ? 'PER_ROOM' : 'LOCATION_WIDE',
            effectiveDate: data.effectiveFrom,
            effectiveTo: data.effectiveTo,
            description: document.description,
          };
        }),
      );
      setHouseRules(
        available(policyPage.items).map((document) => {
          const data = document.data as PolicyTemplateData;
          return {
            id: document.id,
            name: document.name,
            category: 'OTHER_OPERATIONS' as const,
            content: data.content,
            effectiveDate: data.effectiveFrom,
            status: 'ACTIVE' as const,
            version: `V${document.edition}`,
            isAppliedToContracts: false,
          };
        }),
      );
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : 'Không thể tải thư viện cấu hình dùng chung.',
      );
    } finally {
      setIsLoadingLibrary(false);
    }
  };

  const applySharedPolicyTemplates = async () => {
    setIsLoadingLibrary(true);
    setLibraryError('');
    try {
      const page = await sharedApi.list('policy-templates', '', 'Published', 1, 100);
      const templates = page.items.map((document) => {
        const data = document.data as PolicyTemplateData;
        return {
          id: document.id,
          name: document.name,
          category: 'OTHER_OPERATIONS' as const,
          content: data.content,
          effectiveDate: data.effectiveFrom,
          status: 'ACTIVE' as const,
          version: `V${document.edition}`,
          isAppliedToContracts: false,
        };
      });
      setHouseRules((current) => [
        ...current,
        ...templates.filter(
          (template) =>
            !current.some(
              (rule) =>
                rule.name.trim().toLocaleLowerCase() === template.name.trim().toLocaleLowerCase(),
            ),
        ),
      ]);
    } catch (error) {
      setLibraryError(
        error instanceof Error ? error.message : 'Không thể áp dụng nội quy dùng chung.',
      );
    } finally {
      setIsLoadingLibrary(false);
    }
  };

  const loadSourceConfiguration = async () => {
    if (!sourceLocationId || !copyGroups.length) return;
    setIsLoadingCopy(true);
    setCopyError('');
    try {
      const [sourceTypes, sourceRooms, sourceTemplates, sourcePolicies, billingPage] =
        await Promise.all([
          setupApi.roomTypes(sourceLocationId, 1),
          (async () => {
            const first = await setupApi.rooms(sourceLocationId, 1);
            const items = [...first.items];
            for (let page = 2; items.length < first.totalCount; page += 1) {
              const next = await setupApi.rooms(sourceLocationId, page);
              items.push(...next.items);
              if (!next.items.length) break;
            }
            return { ...first, items };
          })(),
          setupApi.templates(sourceLocationId),
          setupApi.policies(sourceLocationId),
          setupApi.request<{
            items: Array<{
              id: string;
              roomId: string | null;
              roomTypeId: string | null;
              category: number;
              chargeCode: string;
              name: string;
              method: number;
              rate: number | string;
              effectiveFrom: string;
              effectiveTo: string | null;
            }>;
          }>(
            `/api/v1/billing-policies?locationId=${encodeURIComponent(sourceLocationId)}&page=1&pageSize=100`,
          ),
        ]);
      const mappedTypes: RoomTypeDraft[] = sourceTypes.items.map((item) => ({
        id: item.id,
        name: item.name,
        code: `RT-${item.id.slice(0, 6).toUpperCase()}`,
        area: Number(item.areaM2 ?? 1),
        maxOccupants: item.defaultCapacity,
        defaultRate: copyGroups.includes('RENT')
          ? Number(
              billingPage.items.find(
                (policy) => policy.roomTypeId === item.id && policy.chargeCode === 'RENT',
              )?.rate ?? 0,
            )
          : 0,
        description: item.description ?? '',
        facilities: item.amenities,
        status: item.isActive ? 'ACTIVE' : 'DRAFT',
      }));
      if (copyGroups.includes('ROOM_TYPES')) {
        setRoomTypes(mappedTypes);
        setSelectedTemplateRoomType(mappedTypes[0]?.id ?? '');
        setBulkRoomTypeId(mappedTypes[0]?.id ?? '');
      }
      if (copyGroups.includes('ROOMS')) {
        setRooms(
          sourceRooms.items.map((room) => ({
            code: room.roomNumber,
            floor: Number(room.floor ?? 1),
            roomTypeId: room.roomTypeId ?? '',
            status: 'AVAILABLE',
          })),
        );
      }
      if (copyGroups.includes('RENT')) {
        const overrides: Record<string, number> = {};
        sourceRooms.items.forEach((room) => {
          const policy = billingPage.items.find(
            (item) => item.roomId === room.id && item.chargeCode === 'RENT',
          );
          if (policy) overrides[room.roomNumber] = Number(policy.rate);
        });
        setRateOverrides(overrides);
      }
      if (copyGroups.includes('ASSETS')) {
        const byType: Record<
          string,
          { catalogId: string; quantity: number; isMandatory: boolean }[]
        > = {};
        mappedTypes.forEach((type) => {
          const template = sourceTemplates.find((item) =>
            item.data.name.toLocaleLowerCase().includes(type.name.toLocaleLowerCase()),
          );
          if (template) {
            byType[type.id] = template.data.items.map((item) => ({
              catalogId: item.id,
              quantity: item.quantity,
              isMandatory: true,
            }));
          }
        });
        setRoomTypeTemplates(byType);
        setAssetCatalog(
          sourceTemplates.flatMap((template) =>
            template.data.items.map((item) => ({
              id: item.id,
              name: item.name,
              category: item.category as AssetCatalogItem['category'],
              defaultCost: 0,
              iconName: 'Package',
              description: template.data.name,
            })),
          ),
        );
      }
      if (copyGroups.includes('FEES')) {
        setFeePolicies(
          billingPage.items
            .filter((policy) => policy.chargeCode !== 'RENT' && !policy.roomId)
            .map((policy) => ({
              id: policy.id,
              name: policy.name,
              chargeCode: policy.chargeCode,
              type:
                policy.category === 1 ? 'ELECTRICITY' : policy.category === 2 ? 'WATER' : 'OTHER',
              calculationMethod: policy.method === 1 ? 'PER_KWH' : 'FIXED_AMOUNT',
              unitPrice: Number(policy.rate),
              unit: policy.category === 1 ? 'kWh' : policy.category === 2 ? 'm³' : 'tháng',
              applicationScope: policy.roomId ? 'PER_ROOM' : 'LOCATION_WIDE',
              targetRoomCode: sourceRooms.items.find((room) => room.id === policy.roomId)
                ?.roomNumber,
              effectiveDate: policy.effectiveFrom,
              effectiveTo: policy.effectiveTo,
              description: `Sao chép từ ${sourceLocationId}`,
            })),
        );
      }
      if (copyGroups.includes('RULES')) {
        setHouseRules(
          sourcePolicies.map((policy) => ({
            id: policy.id,
            name: policy.data.title,
            category: 'OTHER_OPERATIONS',
            content: policy.data.content,
            effectiveDate: policy.data.effectiveFrom,
            status: 'ACTIVE',
            version: `V${policy.version}`,
            isAppliedToContracts: false,
          })),
        );
      }
      setCopyLoaded(true);
    } catch (error) {
      setCopyError(error instanceof Error ? error.message : 'Không thể nạp cấu hình cơ sở nguồn.');
    } finally {
      setIsLoadingCopy(false);
    }
  };

  // Handle Copy Mode selection
  const handleCopyFromSource = (sourceId: string) => {
    setSourceLocationId(sourceId);
    const sourceLoc = db.records.locations.find((l) => l.id === sourceId);
    if (sourceLoc) {
      setLocationName(`${sourceLoc.name} (Bản sao)`);
      setLocationCode(`${sourceLoc.code}-B`);
    }
  };

  // Bulk generate rooms
  const handleGenerateRooms = () => {
    setFinishError('');
    const generated: GeneratedRoomDraft[] = [];
    const existingNumbers = rooms
      .filter((room) => room.floor === bulkFloor && room.code.startsWith(bulkPrefix))
      .map((room) => Number(room.code.slice(bulkPrefix.length)))
      .filter(Number.isFinite);
    const firstRoomNumber = Math.max(bulkFloor * 100, ...existingNumbers) + 1;
    for (let i = 0; i < bulkQuantity; i++) {
      const roomNum = firstRoomNumber + i;
      const code = `${bulkPrefix}${roomNum}`;
      if (!rooms.some((r) => r.code === code)) {
        generated.push({
          code,
          floor: bulkFloor,
          roomTypeId: bulkRoomTypeId,
          status: 'AVAILABLE',
        });
      }
    }
    setRooms((prev) => [...prev, ...generated]);
  };

  const handleRemoveRoom = (code: string) => {
    setFinishError('');
    setRooms((prev) => prev.filter((r) => r.code !== code));
    setRoomAssetAssignments((prev) => prev.filter((assignment) => assignment.roomCode !== code));
    setRateOverrides((prev) => {
      const next = { ...prev };
      delete next[code];
      return next;
    });
  };

  // Apply Asset Template to all rooms of selected Room Type
  const handleApplyAssetTemplate = (typeId: string) => {
    const targetRooms = rooms.filter((r) => r.roomTypeId === typeId);
    const requirements = roomTypeTemplates[typeId] || [];
    const newAssignments: RoomAssetAssignmentDraft[] = [];

    targetRooms.forEach((room) => {
      requirements.forEach((req) => {
        newAssignments.push({
          roomCode: room.code,
          catalogId: req.catalogId,
          quantity: req.quantity,
          condition: 'Active',
          source: 'TEMPLATE',
        });
      });
    });

    setRoomAssetAssignments((prev) => [
      ...prev.filter((a) => !targetRooms.some((r) => r.code === a.roomCode)),
      ...newAssignments,
    ]);

    const typeName = roomTypes.find((t) => t.id === typeId)?.name || 'Loại phòng';
    setTemplateAppliedNotice(
      `Đã áp dụng ${requirements.length} tài sản của loại phòng "${typeName}" cho ${targetRooms.length} phòng.`,
    );
  };

  // Complete wizard
  const handleFinish = async () => {
    const normalizedName = locationName.trim();
    const normalizedAddress = address.trim();
    const roomCodes = rooms.map((room) => room.code.trim().toUpperCase());
    if (!normalizedName || !normalizedAddress) {
      setFinishError('Vui lòng nhập đầy đủ tên và địa chỉ cơ sở trước khi hoàn tất.');
      setActiveStep(0);
      return;
    }
    if (!roomTypes.length || roomTypes.some((roomType) => !roomType.name.trim())) {
      setFinishError('Cơ sở phải có ít nhất một loại phòng hợp lệ.');
      setActiveStep(1);
      return;
    }
    if (
      !rooms.length ||
      roomCodes.some((code) => !code) ||
      new Set(roomCodes).size !== rooms.length
    ) {
      setFinishError('Cơ sở phải có phòng và mã phòng không được để trống hoặc trùng nhau.');
      setActiveStep(2);
      return;
    }
    const invalidRooms = rooms.filter(
      (room) => !roomTypes.some((roomType) => roomType.id === room.roomTypeId),
    );
    if (invalidRooms.length) {
      setFinishError(
        `Không thể lưu vì ${invalidRooms.length} phòng chưa được gán loại phòng hợp lệ: ${invalidRooms
          .map((room) => `${room.code || '(chưa có mã)'} (tầng ${room.floor})`)
          .join(', ')}. Hãy bấm biểu tượng chỉnh sửa tại từng phòng và chọn lại loại phòng.`,
      );
      setActiveStep(2);
      return;
    }
    const newId = `loc-${Date.now()}`;
    const newLocRecord = makeRecord('locations', {
      id: newId,
      code: locationCode,
      name: normalizedName,
      status: operationalStatus === 'ACTIVE' ? 'Đang vận hành' : 'Chuẩn bị vận hành',
      amount: 0,
      attributes: {
        address: normalizedAddress,
        floors: String(floors),
        phone: contactPhone,
        email: contactEmail,
        description,
        amenities: 'Thang máy · Khóa vân tay · Camera 24/7 · Wi-Fi Mesh',
        setupStatus: 'FULLY_CONFIGURED',
      },
    });

    setFinishError('');
    setIsFinishing(true);
    try {
      const completed = await onComplete(newLocRecord, {
        roomTypes,
        rooms,
        feePolicies,
        houseRules,
        rateOverrides,
        roomAssetAssignments,
        assetCatalog,
        roomTypeTemplates,
      });
      if (completed !== false) {
        sessionStorage.removeItem(WIZARD_DRAFT_KEY);
        onClose();
      }
    } catch (error) {
      setFinishError(error instanceof Error ? error.message : 'Không thể hoàn tất cấu hình cơ sở.');
    } finally {
      setIsFinishing(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xl" fullWidth>
      {/* Wizard Header */}
      <DialogTitle
        sx={{ pb: 1, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 2,
              bgcolor: '#ebf2ff',
              color: 'primary.main',
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <Building2 size={22} />
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800 }}>
              Thiết lập cấu hình cơ sở ban đầu (Setup Wizard)
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Quy trình từng bước hướng dẫn thiết lập loại phòng, tạo phòng, tài sản, giá và nội quy
              cho cơ sở mới
            </Typography>
          </Box>
        </Stack>
        <Button size="small" onClick={onClose} sx={{ minWidth: 'auto', p: 0.5 }}>
          <X size={18} />
        </Button>
      </DialogTitle>

      {/* Stepper Progress Bar */}
      <Box sx={{ px: 3, pt: 1, pb: 2, bgcolor: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
        <Stepper activeStep={activeStep} alternativeLabel nonLinear>
          {WIZARD_STEPS.map((label, index) => {
            const isCompleted = activeStep > index;
            return (
              <Step key={label} completed={isCompleted}>
                <StepButton onClick={() => setActiveStep(index)}>
                  <Typography
                    sx={{
                      fontSize: 12,
                      fontWeight: activeStep === index ? 800 : 500,
                      color: activeStep === index ? 'primary.main' : 'inherit',
                    }}
                  >
                    {label}
                  </Typography>
                </StepButton>
              </Step>
            );
          })}
        </Stepper>
      </Box>

      {/* Step Content */}
      <DialogContent
        sx={{ p: 3, minHeight: 520, maxHeight: 'calc(85vh - 160px)', overflowY: 'auto' }}
      >
        {finishError && activeStep !== 7 && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {finishError}
          </Alert>
        )}
        {/* STEP 1: Location Information */}
        {activeStep === 0 && (
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>
              Bước 1: Thông tin cơ sở & Phương thức thiết lập
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Nhập các thuộc tính cơ bản của cơ sở và lựa chọn tạo mới hoàn toàn hoặc sao chép mẫu
              từ một cơ sở đang hoạt động.
            </Typography>

            {/* Setup Mode Selection Cards */}
            <Grid container spacing={2} sx={{ mb: 3.5 }}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 2.5,
                    borderRadius: 2.5,
                    borderColor: setupMode === 'SCRATCH' ? 'primary.main' : '#e2e8f0',
                    bgcolor: setupMode === 'SCRATCH' ? '#f0f7ff' : '#ffffff',
                    borderWidth: setupMode === 'SCRATCH' ? 2 : 1,
                    cursor: 'pointer',
                  }}
                  onClick={() => setSetupMode('SCRATCH')}
                >
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                    <Radio checked={setupMode === 'SCRATCH'} />
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                        Tạo mới hoàn toàn (Create from Scratch)
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Tự cấu hình thủ công các loại phòng, tài sản, biểu phí và nội quy riêng.
                      </Typography>
                    </Box>
                  </Stack>
                </Paper>
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <Paper
                  variant="outlined"
                  sx={{
                    p: 2.5,
                    borderRadius: 2.5,
                    borderColor: setupMode === 'COPY' ? 'primary.main' : '#e2e8f0',
                    bgcolor: setupMode === 'COPY' ? '#f0f7ff' : '#ffffff',
                    borderWidth: setupMode === 'COPY' ? 2 : 1,
                    cursor: 'pointer',
                  }}
                  onClick={() => setSetupMode('COPY')}
                >
                  <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                    <Radio checked={setupMode === 'COPY'} />
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                        Sao chép từ cơ sở có sẵn (Copy Configuration)
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Thừa hưởng toàn bộ mẫu loại phòng, định mức trang bị và biểu phí từ một cơ
                        sở đang vận hành tốt.
                      </Typography>
                    </Box>
                  </Stack>
                </Paper>
              </Grid>
            </Grid>

            {setupMode === 'COPY' && (
              <Alert severity="info" icon={<Copy size={18} />} sx={{ mb: 3, borderRadius: 2 }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                  Chọn cơ sở mẫu để sao chép
                </Typography>
                <Typography variant="body2" sx={{ mb: 1.5 }}>
                  Chọn cơ sở có quy mô và phân khúc tương đồng làm mẫu:
                </Typography>
                <TextField
                  select
                  size="small"
                  label="Cơ sở mẫu nguồn"
                  value={sourceLocationId}
                  onChange={(e) => handleCopyFromSource(e.target.value)}
                  sx={{ bgcolor: '#ffffff', minWidth: 280 }}
                >
                  {db.records.locations.map((loc) => (
                    <MenuItem key={loc.id} value={loc.id}>
                      {loc.name} ({loc.code})
                    </MenuItem>
                  ))}
                </TextField>
                <Typography variant="body2" sx={{ mt: 2, fontWeight: 700 }}>
                  Chọn phần cấu hình cần sao chép:
                </Typography>
                <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5, mt: 0.5 }}>
                  {(
                    [
                      ['ROOM_TYPES', 'Loại phòng'],
                      ['ROOMS', 'Danh sách phòng'],
                      ['ASSETS', 'Tài sản & tiện nghi'],
                      ['RENT', 'Giá thuê'],
                      ['FEES', 'Biểu phí'],
                      ['RULES', 'Nội quy'],
                    ] as [WizardCopyGroup, string][]
                  ).map(([group, label]) => (
                    <FormControlLabel
                      key={group}
                      control={
                        <Checkbox
                          size="small"
                          checked={copyGroups.includes(group)}
                          onChange={() =>
                            setCopyGroups((current) => {
                              if (current.includes(group)) {
                                return group === 'ROOM_TYPES'
                                  ? current.filter(
                                      (item) =>
                                        item !== 'ROOM_TYPES' &&
                                        item !== 'ROOMS' &&
                                        item !== 'ASSETS',
                                    )
                                  : current.filter((item) => item !== group);
                              }
                              return group === 'ROOMS' || group === 'ASSETS'
                                ? Array.from(new Set([...current, 'ROOM_TYPES', group]))
                                : [...current, group];
                            })
                          }
                        />
                      }
                      label={label}
                    />
                  ))}
                </Stack>
                <Button
                  variant="contained"
                  size="small"
                  disabled={isLoadingCopy || !sourceLocationId || !copyGroups.length}
                  onClick={() => void loadSourceConfiguration()}
                >
                  {isLoadingCopy ? 'Đang nạp cấu hình...' : 'Nạp dữ liệu để xem và xác nhận'}
                </Button>
                {copyLoaded && (
                  <Alert severity="success" sx={{ mt: 1 }}>
                    Đã nạp dữ liệu nguồn vào các bước Wizard. Owner có thể xem và chỉnh sửa trước
                    khi hoàn tất.
                  </Alert>
                )}
                {copyError && (
                  <Alert severity="error" sx={{ mt: 1 }}>
                    {copyError}
                  </Alert>
                )}
              </Alert>
            )}

            {/* Location Form Fields */}
            <Grid container spacing={2}>
              <Grid size={{ xs: 12, sm: 8 }}>
                <TextField
                  fullWidth
                  required
                  size="small"
                  label="Tên cơ sở"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth
                  required
                  size="small"
                  label="Mã cơ sở"
                  value={locationCode}
                  onChange={(e) => setLocationCode(e.target.value)}
                  placeholder="CS-04"
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  required
                  size="small"
                  label="Địa chỉ chi tiết"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth
                  required
                  size="small"
                  type="number"
                  label="Số tầng"
                  value={floors}
                  onChange={(e) => setFloors(Math.max(1, parseInt(e.target.value, 10) || 1))}
                  slotProps={{ htmlInput: { min: 1, max: 20 } }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Số điện thoại liên hệ"
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField
                  fullWidth
                  size="small"
                  label="Email quản lý"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  fullWidth
                  multiline
                  rows={2}
                  size="small"
                  label="Mô tả cơ sở & Tiện ích chung"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  select
                  size="small"
                  label="Trạng thái vận hành ban đầu"
                  value={operationalStatus}
                  onChange={(e) => setOperationalStatus(e.target.value as 'ACTIVE' | 'PREPARING')}
                >
                  <MenuItem value="PREPARING">Chuẩn bị vận hành (Bản nháp setup)</MenuItem>
                  <MenuItem value="ACTIVE">Đang vận hành (Sẵn sàng nhận khách)</MenuItem>
                </TextField>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* STEP 2: Room Type Configuration */}
        {activeStep === 1 && (
          <Box>
            <Stack
              direction="row"
              sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}
            >
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  Bước 2: Cấu hình các mẫu loại phòng
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Định nghĩa các phân khúc phòng (diện tích chuẩn, sức chứa, giá thuê mặc định và
                  tiện nghi).
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                {!isMockMode && (
                  <Button
                    variant="outlined"
                    size="small"
                    disabled={isLoadingLibrary}
                    onClick={() => void loadSharedLibrary()}
                  >
                    {isLoadingLibrary ? 'Đang tải...' : 'Nạp thư viện dùng chung'}
                  </Button>
                )}
                <Button
                  variant="contained"
                  size="small"
                  startIcon={<Plus size={16} />}
                  onClick={() => {
                    setEditingRoomType({
                      id: `type-${Date.now()}`,
                      name: '',
                      code: '',
                      area: 20,
                      maxOccupants: 1,
                      defaultRate: 0,
                      description: '',
                      facilities: [],
                      status: 'ACTIVE',
                    });
                  }}
                >
                  Thêm loại phòng
                </Button>
              </Stack>
            </Stack>
            {libraryError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {libraryError}
              </Alert>
            )}

            <Grid container spacing={2}>
              {roomTypes.map((rt) => (
                <Grid key={rt.id} size={{ xs: 12, md: 4 }}>
                  <Card
                    variant="outlined"
                    sx={{
                      borderRadius: 2.5,
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <CardContent sx={{ flex: 1, p: 2.5 }}>
                      <Stack
                        direction="row"
                        sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                      >
                        <Chip
                          size="small"
                          label={rt.code}
                          color="primary"
                          sx={{ fontWeight: 800 }}
                        />
                        <Chip
                          size="small"
                          label={rt.status === 'ACTIVE' ? 'Đang áp dụng' : 'Bản nháp'}
                          color={rt.status === 'ACTIVE' ? 'success' : 'default'}
                          sx={{ fontSize: 11 }}
                        />
                      </Stack>

                      <Typography variant="h6" sx={{ fontWeight: 800, mt: 1.5 }}>
                        {rt.name}
                      </Typography>
                      <Typography
                        variant="body2"
                        color="text.secondary"
                        sx={{ mb: 2, minHeight: 40 }}
                      >
                        {rt.description}
                      </Typography>

                      <Divider sx={{ my: 1.5 }} />

                      <Stack spacing={1}>
                        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                          <Typography variant="caption" color="text.secondary">
                            Diện tích chuẩn:
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 750 }}>
                            {rt.area} m²
                          </Typography>
                        </Stack>
                        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                          <Typography variant="caption" color="text.secondary">
                            Sức chứa tối đa:
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 750 }}>
                            {rt.maxOccupants} người
                          </Typography>
                        </Stack>
                        <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                          <Typography variant="caption" color="text.secondary">
                            Giá thuê mặc định:
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{ fontWeight: 800, color: 'primary.main' }}
                          >
                            {rt.defaultRate.toLocaleString()} VND/tháng
                          </Typography>
                        </Stack>
                      </Stack>

                      <Box sx={{ mt: 2 }}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: 'block', mb: 0.5 }}
                        >
                          Trang bị tiêu chuẩn:
                        </Typography>
                        <Stack direction="row" sx={{ flexWrap: 'wrap', gap: 0.5 }}>
                          {rt.facilities.map((fac) => (
                            <Chip key={fac} label={fac} size="small" sx={{ fontSize: 11 }} />
                          ))}
                        </Stack>
                      </Box>
                    </CardContent>

                    <Divider />
                    <Stack
                      direction="row"
                      sx={{ justifyContent: 'flex-end', p: 1, gap: 1, bgcolor: '#f8fafc' }}
                    >
                      <Button
                        size="small"
                        startIcon={<Copy size={14} />}
                        onClick={() => {
                          const dup: RoomTypeDraft = {
                            ...rt,
                            id: `type-${Date.now()}`,
                            code: `${rt.code}-CP`,
                            name: `${rt.name} (Bản sao)`,
                          };
                          setRoomTypes((prev) => [...prev, dup]);
                        }}
                      >
                        Nhân bản
                      </Button>
                      <Button size="small" onClick={() => setEditingRoomType({ ...rt })}>
                        Chỉnh sửa
                      </Button>
                      <Button
                        size="small"
                        color="error"
                        disabled={roomTypes.length <= 1}
                        onClick={() =>
                          setRoomTypes((prev) => prev.filter((item) => item.id !== rt.id))
                        }
                      >
                        Xóa
                      </Button>
                    </Stack>
                  </Card>
                </Grid>
              ))}
            </Grid>
          </Box>
        )}

        {/* STEP 3: Room Configuration */}
        {activeStep === 2 && (
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
              Bước 3: Danh sách phòng & Tạo phòng hàng loạt
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              Tạo phòng theo sơ đồ tầng. Các phòng sẽ tự động thừa hưởng diện tích và giá thuê mặc
              định từ Loại phòng được gán.
            </Typography>

            {/* Bulk Creator Form */}
            <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5, mb: 3, bgcolor: '#f8fafc' }}>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}
              >
                <Layers3 size={18} /> Công cụ tạo phòng hàng loạt theo tầng
              </Typography>
              <Grid container spacing={2} sx={{ alignItems: 'center' }}>
                <Grid size={{ xs: 12, sm: 3 }}>
                  <TextField
                    fullWidth
                    select
                    size="small"
                    label="Tầng bố trí"
                    value={bulkFloor}
                    onChange={(e) => setBulkFloor(parseInt(e.target.value, 10))}
                  >
                    {Array.from({ length: floors }, (_, i) => i + 1).map((fl) => (
                      <MenuItem key={fl} value={fl}>
                        Tầng {fl}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 12, sm: 3 }}>
                  <TextField
                    fullWidth
                    select
                    size="small"
                    label="Loại phòng gán"
                    value={bulkRoomTypeId}
                    onChange={(e) => setBulkRoomTypeId(e.target.value)}
                  >
                    {roomTypes.map((rt) => (
                      <MenuItem key={rt.id} value={rt.id}>
                        {rt.name} ({rt.code})
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid size={{ xs: 6, sm: 2 }}>
                  <TextField
                    fullWidth
                    size="small"
                    label="Tiền tố"
                    value={bulkPrefix}
                    onChange={(e) => setBulkPrefix(e.target.value)}
                  />
                </Grid>
                <Grid size={{ xs: 6, sm: 2 }}>
                  <TextField
                    fullWidth
                    type="number"
                    size="small"
                    label="Số lượng phòng"
                    value={bulkQuantity}
                    onChange={(e) =>
                      setBulkQuantity(Math.max(1, parseInt(e.target.value, 10) || 1))
                    }
                  />
                </Grid>
                <Grid size={{ xs: 12, sm: 2 }}>
                  <Button
                    fullWidth
                    variant="contained"
                    disabled={!roomTypes.some((roomType) => roomType.id === bulkRoomTypeId)}
                    onClick={handleGenerateRooms}
                    startIcon={<Sparkles size={16} />}
                  >
                    Sinh phòng
                  </Button>
                </Grid>
              </Grid>
            </Paper>

            {/* Generated Rooms Table */}
            <Stack
              direction="row"
              sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                Danh sách phòng đã cấu hình ({rooms.length} phòng)
              </Typography>
              <Chip size="small" label={`Thừa hưởng từ ${roomTypes.length} loại phòng`} />
            </Stack>

            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2.5 }}>
              <Table size="small">
                <TableHead sx={{ bgcolor: '#f8fafc' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 800 }}>Mã phòng</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Tầng</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Loại phòng</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Diện tích</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Giá thuê mặc định</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Trạng thái</TableCell>
                    <TableCell sx={{ fontWeight: 800, width: 140 }}>Thao tác</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rooms.map((room) => {
                    const rType = roomTypes.find((t) => t.id === room.roomTypeId);
                    return (
                      <TableRow key={room.code} hover>
                        <TableCell sx={{ fontWeight: 800 }}>{room.code}</TableCell>
                        <TableCell>Tầng {room.floor}</TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={rType?.name || 'Tiêu chuẩn'}
                            sx={{ fontWeight: 700 }}
                          />
                        </TableCell>
                        <TableCell>{rType?.area || 25} m² (Thừa hưởng)</TableCell>
                        <TableCell sx={{ fontWeight: 750, color: 'primary.main' }}>
                          {(rType?.defaultRate || 5500000).toLocaleString()} VND
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label="Sẵn sàng"
                            color="success"
                            sx={{ fontSize: 11 }}
                          />
                        </TableCell>
                        <TableCell>
                          <IconButton
                            size="small"
                            color="primary"
                            onClick={() => {
                              setEditingRoom({ ...room });
                              setEditingRoomOriginalCode(room.code);
                            }}
                          >
                            <Edit2 size={16} />
                          </IconButton>
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => handleRemoveRoom(room.code)}
                          >
                            <Trash2 size={16} />
                          </IconButton>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {/* STEP 4: Asset Configuration */}
        {activeStep === 3 && (
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
              Bước 4: Danh mục tài sản, Định mức & Phân bổ vào phòng
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              Chọn tài sản dùng cho từng loại phòng, sau đó áp dụng danh sách đó cho các phòng tương
              ứng.
            </Typography>

            {templateAppliedNotice && (
              <Alert
                severity="success"
                onClose={() => setTemplateAppliedNotice(null)}
                sx={{ mb: 2.5, borderRadius: 2 }}
              >
                {templateAppliedNotice}
              </Alert>
            )}

            <Grid container spacing={2.5}>
              {/* Asset Catalog Column */}
              <Grid size={{ xs: 12, md: 4 }}>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, height: '100%' }}>
                  <Typography
                    variant="subtitle2"
                    sx={{ fontWeight: 800, mb: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}
                  >
                    <Package size={18} /> Danh mục tài sản mẫu
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mb: 2 }}
                  >
                    Các trang thiết bị nội thất & điện máy tiêu chuẩn của BHOME.
                  </Typography>

                  <Stack spacing={1} sx={{ maxHeight: 380, overflowY: 'auto', pr: 0.5 }}>
                    {assetCatalog.map((item) => (
                      <Box
                        key={item.id}
                        sx={{
                          p: 1.25,
                          borderRadius: 1.5,
                          border: '1px solid #e2e8f0',
                          bgcolor: '#f8fafc',
                        }}
                      >
                        <Stack
                          direction="row"
                          sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                        >
                          <Typography variant="body2" sx={{ fontWeight: 750 }}>
                            {item.name}
                          </Typography>
                          <Chip size="small" label={item.category} sx={{ fontSize: 10 }} />
                        </Stack>
                        <Typography variant="caption" color="text.secondary">
                          Đơn giá dự kiến: {item.defaultCost.toLocaleString()} VND
                        </Typography>
                        <Button
                          size="small"
                          sx={{ mt: 0.5 }}
                          disabled={
                            !selectedTemplateRoomType ||
                            roomTypeTemplates[selectedTemplateRoomType]?.some(
                              (requirement) => requirement.catalogId === item.id,
                            )
                          }
                          onClick={() =>
                            setRoomTypeTemplates((current) => ({
                              ...current,
                              [selectedTemplateRoomType]: [
                                ...(current[selectedTemplateRoomType] ?? []),
                                { catalogId: item.id, quantity: 1, isMandatory: true },
                              ],
                            }))
                          }
                        >
                          Thêm vào định mức
                        </Button>
                      </Box>
                    ))}
                  </Stack>
                </Paper>
              </Grid>

              {/* Room Type Template Column */}
              <Grid size={{ xs: 12, md: 8 }}>
                <Paper variant="outlined" sx={{ p: 2, borderRadius: 2.5, height: '100%' }}>
                  <Stack
                    direction="row"
                    sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}
                  >
                    <Box>
                      <Typography
                        variant="subtitle2"
                        sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1 }}
                      >
                        <Layers3 size={18} /> Tài sản áp dụng theo loại phòng
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Định mức thiết bị tiêu chuẩn cho loại phòng được chọn.
                      </Typography>
                    </Box>

                    <TextField
                      select
                      size="small"
                      value={selectedTemplateRoomType}
                      onChange={(e) => setSelectedTemplateRoomType(e.target.value)}
                      sx={{ minWidth: 200 }}
                    >
                      {roomTypes.map((rt) => (
                        <MenuItem key={rt.id} value={rt.id}>
                          {rt.name}
                        </MenuItem>
                      ))}
                    </TextField>
                  </Stack>

                  <TableContainer sx={{ border: '1px solid #e2e8f0', borderRadius: 2, mb: 2 }}>
                    <Table size="small">
                      <TableHead sx={{ bgcolor: '#f8fafc' }}>
                        <TableRow>
                          <TableCell sx={{ fontWeight: 800 }}>Tên thiết bị</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>Số lượng chuẩn</TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>Yêu cầu bắt buộc</TableCell>
                          <TableCell sx={{ width: 60 }} />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {(roomTypeTemplates[selectedTemplateRoomType] || []).map((req) => {
                          const catalogItem = assetCatalog.find((c) => c.id === req.catalogId);
                          return (
                            <TableRow key={req.catalogId}>
                              <TableCell sx={{ fontWeight: 700 }}>
                                {catalogItem?.name || req.catalogId}
                              </TableCell>
                              <TableCell>{req.quantity} cái</TableCell>
                              <TableCell>
                                <Chip
                                  size="small"
                                  label={req.isMandatory ? 'Bắt buộc bàn giao' : 'Tùy chọn'}
                                  color={req.isMandatory ? 'primary' : 'default'}
                                  sx={{ fontSize: 11 }}
                                />
                              </TableCell>
                              <TableCell>
                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() =>
                                    setRoomTypeTemplates((current) => ({
                                      ...current,
                                      [selectedTemplateRoomType]: (
                                        current[selectedTemplateRoomType] ?? []
                                      ).filter((item) => item.catalogId !== req.catalogId),
                                    }))
                                  }
                                >
                                  <Trash2 size={15} />
                                </IconButton>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>

                  <Stack
                    direction="row"
                    sx={{ alignItems: 'center', justifyContent: 'space-between', pt: 1 }}
                  >
                    <Typography variant="caption" color="text.secondary">
                      Áp dụng định mức này cho toàn bộ{' '}
                      {rooms.filter((r) => r.roomTypeId === selectedTemplateRoomType).length} phòng
                      thuộc loại này.
                    </Typography>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<Sparkles size={16} />}
                      onClick={() => handleApplyAssetTemplate(selectedTemplateRoomType)}
                    >
                      Áp dụng tất cả tài sản cho loại phòng
                    </Button>
                  </Stack>
                </Paper>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* STEP 5: Rental Rate Configuration */}
        {activeStep === 4 && (
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
              Bước 5: Giá thuê phòng & Phân cấp định giá
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
              Phân cấp định giá:{' '}
              <strong>Giá chuẩn loại phòng → Giá áp dụng → Giá điều chỉnh riêng từng phòng</strong>.
            </Typography>

            <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2.5 }}>
              <Table size="small">
                <TableHead sx={{ bgcolor: '#f8fafc' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 800 }}>Mã phòng</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Tầng</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Loại phòng</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Giá chuẩn</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Giá áp dụng</TableCell>
                    <TableCell sx={{ fontWeight: 800 }}>Nguồn định giá</TableCell>
                    <TableCell sx={{ fontWeight: 800, width: 220 }}>Giá riêng (VND)</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rooms.map((room) => {
                    const rType = roomTypes.find((t) => t.id === room.roomTypeId);
                    const defaultRate = rType?.defaultRate || 5500000;
                    const override = rateOverrides[room.code];
                    const isOverridden = override !== undefined && override !== defaultRate;
                    const appliedRate = isOverridden ? override : defaultRate;

                    return (
                      <TableRow key={room.code} hover>
                        <TableCell sx={{ fontWeight: 800 }}>{room.code}</TableCell>
                        <TableCell>Tầng {room.floor}</TableCell>
                        <TableCell>{rType?.name}</TableCell>
                        <TableCell sx={{ color: 'text.secondary' }}>
                          {defaultRate.toLocaleString()} VND
                        </TableCell>
                        <TableCell
                          sx={{ fontWeight: 800, color: isOverridden ? '#b45309' : 'primary.main' }}
                        >
                          {appliedRate.toLocaleString()} VND
                        </TableCell>
                        <TableCell>
                          <Chip
                            size="small"
                            label={isOverridden ? 'Giá chỉnh sửa riêng' : 'Chuẩn theo loại phòng'}
                            color={isOverridden ? 'warning' : 'default'}
                            sx={{ fontWeight: 750, fontSize: 11 }}
                          />
                        </TableCell>
                        <TableCell>
                          <TextField
                            size="small"
                            type="number"
                            placeholder="Nhập giá riêng"
                            value={override !== undefined ? override : ''}
                            onChange={(e) => {
                              const val = e.target.value ? parseInt(e.target.value, 10) : undefined;
                              setRateOverrides((prev) => {
                                const next = { ...prev };
                                if (val) next[room.code] = val;
                                else delete next[room.code];
                                return next;
                              });
                            }}
                            slotProps={{
                              input: {
                                endAdornment: <InputAdornment position="end">VND</InputAdornment>,
                              },
                            }}
                            sx={{ width: 190 }}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}

        {/* STEP 6: Fee Policy Configuration */}
        {activeStep === 5 && (
          <Box>
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
                Bước 6: Biểu phí điện nước & Dịch vụ đi kèm
              </Typography>
              <Button
                size="small"
                startIcon={<Plus size={15} />}
                onClick={() =>
                  setEditingFee({
                    id: `fee-${Date.now()}`,
                    name: '',
                    type: 'OTHER',
                    calculationMethod: 'FIXED_AMOUNT',
                    unitPrice: 0,
                    unit: 'VND/tháng',
                    applicationScope: 'LOCATION_WIDE',
                    effectiveDate: new Date().toISOString().slice(0, 10),
                    description: '',
                  })
                }
              >
                Thêm khoản phí
              </Button>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Cấu hình biểu phí điện nước và các khoản phí dịch vụ định kỳ.
            </Typography>

            {/* Regulatory Notice Banner */}
            <Alert
              severity="warning"
              icon={<AlertTriangle size={20} />}
              sx={{
                mb: 3,
                borderRadius: 2,
                bgcolor: '#fffbeb',
                color: '#92400e',
                border: '1px solid #fde68a',
              }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                Cảnh báo khung giá điện & nước sinh hoạt theo quy định pháp luật
              </Typography>
              <Typography variant="body2">
                Giá điện nước cho người thuê nhà để ở tuân thủ theo biểu giá của EVN và Quyết định
                của UBND tỉnh/thành phố. Vui lòng đảm bảo đơn giá cấu hình không vượt quá trần quy
                định hiện hành.
              </Typography>
            </Alert>

            <Grid container spacing={2.5}>
              <Grid size={{ xs: 12, md: 7 }}>
                <TableContainer component={Paper} variant="outlined" sx={{ borderRadius: 2.5 }}>
                  <Table size="small">
                    <TableHead sx={{ bgcolor: '#f8fafc' }}>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 800 }}>Khoản phí</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>Cách tính</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>Đơn giá</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>Phạm vi</TableCell>
                        <TableCell sx={{ fontWeight: 800 }}>Thao tác</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {feePolicies.map((fee) => (
                        <TableRow key={fee.id}>
                          <TableCell sx={{ fontWeight: 750 }}>
                            {fee.name}
                            {fee.isRegulatoryControlled && (
                              <Chip
                                size="small"
                                label="Khung giá nhà nước"
                                color="warning"
                                sx={{ ml: 1, fontSize: 10 }}
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            <Chip
                              size="small"
                              label={
                                fee.calculationMethod === 'PER_KWH'
                                  ? 'Theo kWh'
                                  : fee.calculationMethod === 'PER_M3'
                                    ? 'Theo m³'
                                    : 'Theo phòng'
                              }
                            />
                          </TableCell>
                          <TableCell sx={{ fontWeight: 800 }}>
                            {fee.unitPrice.toLocaleString()} {fee.unit}
                          </TableCell>
                          <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>
                            {fee.applicationScope === 'LOCATION_WIDE' ? 'Toàn cơ sở' : 'Từng phòng'}
                          </TableCell>
                          <TableCell>
                            <Button size="small" onClick={() => setEditingFee({ ...fee })}>
                              Chỉnh sửa
                            </Button>
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() =>
                                setFeePolicies((current) =>
                                  current.filter((item) => item.id !== fee.id),
                                )
                              }
                            >
                              <Trash2 size={15} />
                            </IconButton>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </Grid>

              {/* Occupied Room Monthly Charge Preview */}
              <Grid size={{ xs: 12, md: 5 }}>
                <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5, bgcolor: '#f8fafc' }}>
                  <Typography
                    variant="subtitle2"
                    sx={{ fontWeight: 800, mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}
                  >
                    <BadgeDollarSign size={18} /> Mô phỏng chi phí hàng tháng của phòng
                  </Typography>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ display: 'block', mb: 2 }}
                  >
                    Mô phỏng bảng kê hóa đơn dự kiến của một khách thuê dựa trên mức tiêu thụ điện
                    nước giả định.
                  </Typography>

                  <Grid container spacing={1.5} sx={{ mb: 2 }}>
                    <Grid size={{ xs: 12 }}>
                      <TextField
                        select
                        fullWidth
                        size="small"
                        label="Loại phòng mô phỏng"
                        value={previewRoomType?.id ?? ''}
                        onChange={(event) => setPreviewRoomTypeId(event.target.value)}
                      >
                        {roomTypes.map((roomType) => (
                          <MenuItem key={roomType.id} value={roomType.id}>
                            {roomType.name} · {roomType.defaultRate.toLocaleString()} VND/tháng
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>
                    <Grid size={{ xs: 6 }}>
                      <TextField
                        fullWidth
                        size="small"
                        type="number"
                        label="Số điện giả định (kWh)"
                        value={previewKwh}
                        onChange={(e) => setPreviewKwh(parseInt(e.target.value, 10) || 0)}
                      />
                    </Grid>
                    <Grid size={{ xs: 6 }}>
                      <TextField
                        fullWidth
                        size="small"
                        type="number"
                        label="Số nước giả định (m³)"
                        value={previewM3}
                        onChange={(e) => setPreviewM3(parseInt(e.target.value, 10) || 0)}
                      />
                    </Grid>
                  </Grid>

                  <Stack spacing={1} sx={{ pt: 1, borderTop: '1px dashed #cbd5e1' }}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Tiền thuê {previewRoomType?.name ?? 'loại phòng đã chọn'}:
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {previewRent.toLocaleString()} VND
                      </Typography>
                    </Stack>
                    {feePolicies.map((fee) => (
                      <Stack
                        key={fee.id}
                        direction="row"
                        sx={{ justifyContent: 'space-between', gap: 2 }}
                      >
                        <Typography variant="body2" color="text.secondary">
                          {fee.name}
                          {fee.calculationMethod === 'PER_KWH'
                            ? ` (${previewKwh} kWh × ${fee.unitPrice.toLocaleString()})`
                            : fee.calculationMethod === 'PER_M3'
                              ? ` (${previewM3} m³ × ${fee.unitPrice.toLocaleString()})`
                              : ''}
                          :
                        </Typography>
                        <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                          {previewFeeAmount(fee).toLocaleString()} VND
                        </Typography>
                      </Stack>
                    ))}

                    <Divider sx={{ my: 0.5 }} />

                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
                        Tổng tiền dự kiến trên hóa đơn:
                      </Typography>
                      <Typography
                        variant="subtitle1"
                        sx={{ fontWeight: 850, color: 'primary.main' }}
                      >
                        {(previewRent + previewFeesTotal).toLocaleString()} VND
                      </Typography>
                    </Stack>
                  </Stack>
                </Paper>
              </Grid>
            </Grid>
          </Box>
        )}

        {/* STEP 7: House Rules & Policies */}
        {activeStep === 6 && (
          <Box>
            <Stack
              direction="row"
              sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}
            >
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                  Bước 7: Nội quy & Quy định vận hành cơ sở
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Cấu hình các quy định về giờ giấc, người thăm, an toàn PCCC, và chính sách tiền
                  cọc.
                </Typography>
              </Box>
              <Stack direction="row" spacing={1}>
                <Button
                  variant="outlined"
                  size="small"
                  disabled={isLoadingLibrary}
                  onClick={() => void applySharedPolicyTemplates()}
                >
                  {isLoadingLibrary ? 'Đang tải...' : 'Áp dụng nội quy dùng chung'}
                </Button>
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<Plus size={16} />}
                  onClick={() => {
                    setEditingRule({
                      id: `rule-${Date.now()}`,
                      name: '',
                      category: 'OTHER_OPERATIONS',
                      content: '',
                      effectiveDate: new Date().toISOString().slice(0, 10),
                      status: 'DRAFT',
                      version: 'V1',
                      isAppliedToContracts: false,
                    });
                  }}
                >
                  Thêm quy định riêng
                </Button>
              </Stack>
            </Stack>

            {libraryError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {libraryError}
              </Alert>
            )}

            <Grid container spacing={2}>
              {houseRules.map((rule) => (
                <Grid key={rule.id} size={{ xs: 12, md: 6 }}>
                  <Paper
                    variant="outlined"
                    sx={{
                      p: 2,
                      borderRadius: 2.5,
                      bgcolor: '#ffffff',
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <Stack
                      direction="row"
                      sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1 }}
                    >
                      <Chip
                        size="small"
                        label={rule.name}
                        color="primary"
                        variant="outlined"
                        sx={{ fontWeight: 700, fontSize: 11 }}
                      />
                      <Stack direction="row">
                        <IconButton size="small" onClick={() => setEditingRule({ ...rule })}>
                          <Edit2 size={15} />
                        </IconButton>
                        <IconButton
                          size="small"
                          color="error"
                          onClick={() =>
                            setHouseRules((current) =>
                              current.filter((item) => item.id !== rule.id),
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </IconButton>
                      </Stack>
                      <Chip
                        size="small"
                        label={`Phiên bản ${rule.version}`}
                        sx={{ fontWeight: 800 }}
                      />
                    </Stack>

                    <Typography variant="subtitle2" sx={{ fontWeight: 800, mt: 0.5 }}>
                      {rule.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ mt: 1, flex: 1 }}>
                      {rule.content}
                    </Typography>

                    <Divider sx={{ my: 1.5 }} />

                    <Stack
                      direction="row"
                      sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                    >
                      <Typography variant="caption" color="text.secondary">
                        Hiệu lực: {rule.effectiveDate}
                      </Typography>
                      <Chip
                        size="small"
                        label={rule.status === 'ACTIVE' ? 'Đang áp dụng' : 'Bản nháp'}
                        color={rule.status === 'ACTIVE' ? 'success' : 'default'}
                        sx={{ fontSize: 11 }}
                      />
                    </Stack>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </Box>
        )}

        {/* STEP 8: Review & Finish */}
        {activeStep === 7 && (
          <Box>
            <Stack direction="row" spacing={2} sx={{ alignItems: 'center', mb: 3 }}>
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: '50%',
                  bgcolor: '#dcfce7',
                  color: '#15803d',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <CheckCircle2 size={26} />
              </Box>
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  Đã hoàn tất cấu hình — Sẵn sàng đưa vào vận hành
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Kiểm tra lại toàn bộ danh mục thông tin đã thiết lập trước khi lưu và chuyển vào
                  không gian quản lý chi tiết.
                </Typography>
              </Box>
            </Stack>

            <Grid container spacing={2.5}>
              <Grid size={{ xs: 12, md: 6 }}>
                <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5, bgcolor: '#f8fafc' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1.5 }}>
                    Thông tin cơ sở & Quy mô
                  </Typography>
                  <Stack spacing={1}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Tên & Mã cơ sở:
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 750 }}>
                        {locationName} ({locationCode})
                      </Typography>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Quy mô phòng:
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 750 }}>
                        {floors} tầng · {rooms.length} phòng đã tạo
                      </Typography>
                    </Stack>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Địa chỉ:
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700, textAlign: 'right' }}>
                        {address}
                      </Typography>
                    </Stack>
                  </Stack>
                </Paper>
              </Grid>

              <Grid size={{ xs: 12, md: 6 }}>
                <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 2.5, bgcolor: '#f8fafc' }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1.5 }}>
                    Danh mục cấu hình đã sẵn sàng
                  </Typography>
                  <Stack spacing={1}>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Loại phòng:
                      </Typography>
                      <Chip
                        size="small"
                        label={`${roomTypes.length} loại phòng sẵn sàng`}
                        color="primary"
                      />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {roomTypes.length
                        ? roomTypes
                            .map(
                              (roomType) =>
                                `${roomType.name} (${rooms.filter((room) => room.roomTypeId === roomType.id).length} phòng)`,
                            )
                            .join(' · ')
                        : 'Chưa có loại phòng'}
                    </Typography>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Tài sản & Tiện nghi:
                      </Typography>
                      <Chip
                        size="small"
                        label={`${assignedAssetNames.length} tài sản đã gán`}
                        color="success"
                      />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {assignedAssetNames.length
                        ? assignedAssetNames.join(' · ')
                        : 'Chưa gán tài sản cho loại phòng nào'}
                    </Typography>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Biểu phí điện nước:
                      </Typography>
                      <Chip
                        size="small"
                        label={`${feePolicies.length} khoản phí đã cấu hình`}
                        color="info"
                      />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {feePolicies.length
                        ? feePolicies
                            .map(
                              (fee) => `${fee.name}: ${fee.unitPrice.toLocaleString()} ${fee.unit}`,
                            )
                            .join(' · ')
                        : 'Chưa cấu hình khoản phí'}
                    </Typography>
                    <Stack direction="row" sx={{ justifyContent: 'space-between' }}>
                      <Typography variant="body2" color="text.secondary">
                        Nội quy cơ sở:
                      </Typography>
                      <Chip
                        size="small"
                        label={`${houseRules.length} quy định hiệu lực`}
                        color="default"
                      />
                    </Stack>
                    <Typography variant="caption" color="text.secondary">
                      {houseRules.length
                        ? houseRules.map((rule) => rule.name).join(' · ')
                        : 'Chưa áp dụng nội quy'}
                    </Typography>
                  </Stack>
                </Paper>
              </Grid>
            </Grid>
          </Box>
        )}
        {finishError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {finishError}
          </Alert>
        )}
      </DialogContent>

      <Divider />

      {/* Navigation Actions */}
      <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
        <Button
          variant="outlined"
          disabled={activeStep === 0}
          onClick={() => setActiveStep((prev) => Math.max(0, prev - 1))}
          startIcon={<ArrowLeft size={16} />}
        >
          Quay lại
        </Button>

        <Stack direction="row" spacing={1.5}>
          <Button variant="outlined" onClick={onClose} disabled={isFinishing}>
            Hủy thiết lập
          </Button>
          {activeStep < WIZARD_STEPS.length - 1 ? (
            <Button
              variant="contained"
              onClick={() => {
                if (
                  activeStep === 0 &&
                  setupMode === 'SCRATCH' &&
                  !isMockMode &&
                  !roomTypes.length
                ) {
                  void loadSharedLibrary();
                }
                setActiveStep((prev) => Math.min(WIZARD_STEPS.length - 1, prev + 1));
              }}
              endIcon={<ArrowRight size={16} />}
            >
              Tiếp tục ({WIZARD_STEPS[activeStep + 1]})
            </Button>
          ) : (
            <Button
              variant="contained"
              color="primary"
              onClick={() => void handleFinish()}
              disabled={isFinishing}
              startIcon={<Sparkles size={16} />}
            >
              {isFinishing ? 'Đang lưu cấu hình...' : 'Hoàn tất & Kích hoạt cơ sở'}
            </Button>
          )}
        </Stack>
      </DialogActions>
      <Dialog
        open={!!editingRoomType}
        onClose={() => setEditingRoomType(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Chỉnh sửa loại phòng</DialogTitle>
        <DialogContent>
          {editingRoomType && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="Tên loại phòng"
                value={editingRoomType.name}
                onChange={(event) =>
                  setEditingRoomType({ ...editingRoomType, name: event.target.value })
                }
              />
              <TextField
                label="Mã loại phòng"
                value={editingRoomType.code}
                onChange={(event) =>
                  setEditingRoomType({ ...editingRoomType, code: event.target.value })
                }
              />
              <TextField
                type="number"
                label="Diện tích (m²)"
                value={editingRoomType.area}
                onChange={(event) =>
                  setEditingRoomType({ ...editingRoomType, area: Number(event.target.value) })
                }
              />
              <TextField
                type="number"
                label="Sức chứa tối đa"
                value={editingRoomType.maxOccupants}
                onChange={(event) =>
                  setEditingRoomType({
                    ...editingRoomType,
                    maxOccupants: Number(event.target.value),
                  })
                }
              />
              <TextField
                type="number"
                label="Giá thuê mặc định"
                value={editingRoomType.defaultRate}
                onChange={(event) =>
                  setEditingRoomType({
                    ...editingRoomType,
                    defaultRate: Number(event.target.value),
                  })
                }
              />
              <TextField
                multiline
                label="Mô tả"
                value={editingRoomType.description}
                onChange={(event) =>
                  setEditingRoomType({ ...editingRoomType, description: event.target.value })
                }
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingRoomType(null)}>Hủy</Button>
          <Button
            variant="contained"
            disabled={
              !editingRoomType?.name.trim() ||
              !editingRoomType.code.trim() ||
              editingRoomType.area <= 0 ||
              editingRoomType.maxOccupants <= 0 ||
              editingRoomType.defaultRate < 0
            }
            onClick={() => {
              if (!editingRoomType) return;
              setRoomTypes((current) => {
                const normalized = {
                  ...editingRoomType,
                  name: editingRoomType.name.trim(),
                  code: editingRoomType.code.trim().toUpperCase(),
                };
                return current.some((item) => item.id === editingRoomType.id)
                  ? current.map((item) => (item.id === editingRoomType.id ? normalized : item))
                  : [...current, normalized];
              });
              if (!selectedTemplateRoomType) setSelectedTemplateRoomType(editingRoomType.id);
              if (!bulkRoomTypeId) setBulkRoomTypeId(editingRoomType.id);
              setEditingRoomType(null);
            }}
          >
            Lưu thay đổi
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!editingRoom} onClose={() => setEditingRoom(null)} fullWidth maxWidth="sm">
        <DialogTitle>Chỉnh sửa phòng</DialogTitle>
        <DialogContent>
          {editingRoom && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="Mã phòng"
                value={editingRoom.code}
                onChange={(event) => setEditingRoom({ ...editingRoom, code: event.target.value })}
              />
              <TextField
                type="number"
                label="Tầng"
                value={editingRoom.floor}
                onChange={(event) =>
                  setEditingRoom({ ...editingRoom, floor: Number(event.target.value) })
                }
              />
              <TextField
                select
                label="Loại phòng"
                value={editingRoom.roomTypeId}
                onChange={(event) =>
                  setEditingRoom({ ...editingRoom, roomTypeId: event.target.value })
                }
              >
                {roomTypes.map((roomType) => (
                  <MenuItem key={roomType.id} value={roomType.id}>
                    {roomType.name}
                  </MenuItem>
                ))}
              </TextField>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingRoom(null)}>Hủy</Button>
          <Button
            variant="contained"
            disabled={
              !editingRoom?.code.trim() ||
              editingRoom.floor < 1 ||
              !editingRoom.roomTypeId ||
              rooms.some(
                (room) =>
                  room.code !== editingRoomOriginalCode &&
                  room.code.trim().toUpperCase() === editingRoom.code.trim().toUpperCase(),
              )
            }
            onClick={() => {
              if (!editingRoom) return;
              const normalized = { ...editingRoom, code: editingRoom.code.trim().toUpperCase() };
              setRooms((current) =>
                current.map((room) => (room.code === editingRoomOriginalCode ? normalized : room)),
              );
              setRoomAssetAssignments((current) =>
                current.map((assignment) =>
                  assignment.roomCode === editingRoomOriginalCode
                    ? { ...assignment, roomCode: normalized.code }
                    : assignment,
                ),
              );
              setRateOverrides((current) => {
                if (!(editingRoomOriginalCode in current)) return current;
                const next = { ...current, [normalized.code]: current[editingRoomOriginalCode] };
                delete next[editingRoomOriginalCode];
                return next;
              });
              setFinishError('');
              setEditingRoom(null);
            }}
          >
            Lưu thay đổi
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!editingFee} onClose={() => setEditingFee(null)} fullWidth maxWidth="sm">
        <DialogTitle>Cấu hình khoản phí của cơ sở</DialogTitle>
        <DialogContent>
          {editingFee && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="Tên khoản phí"
                value={editingFee.name}
                onChange={(event) => setEditingFee({ ...editingFee, name: event.target.value })}
              />
              <TextField
                label="Mã khoản thu"
                value={editingFee.chargeCode ?? ''}
                onChange={(event) =>
                  setEditingFee({
                    ...editingFee,
                    chargeCode: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '_'),
                  })
                }
                helperText="Mã duy nhất để đối soát và lập hóa đơn, ví dụ INTERNET hoặc PARKING."
              />
              <TextField
                select
                label="Nhóm phí"
                value={editingFee.type}
                onChange={(event) => {
                  const type = event.target.value as FeePolicyItem['type'];
                  setEditingFee({
                    ...editingFee,
                    type,
                    calculationMethod:
                      type === 'ELECTRICITY'
                        ? 'PER_KWH'
                        : type === 'WATER'
                          ? 'PER_M3'
                          : 'FIXED_AMOUNT',
                    unit:
                      type === 'ELECTRICITY'
                        ? 'VND/kWh'
                        : type === 'WATER'
                          ? 'VND/m³'
                          : 'VND/tháng',
                  });
                }}
              >
                <MenuItem value="ELECTRICITY">Điện</MenuItem>
                <MenuItem value="WATER">Nước</MenuItem>
                <MenuItem value="ENVIRONMENTAL_CLEANING">Vệ sinh & môi trường</MenuItem>
                <MenuItem value="SECURITY">An ninh</MenuItem>
                <MenuItem value="INTERNET">Internet</MenuItem>
                <MenuItem value="PARKING">Giữ xe</MenuItem>
                <MenuItem value="OTHER">Dịch vụ khác</MenuItem>
              </TextField>
              <TextField
                select
                label="Cách tính"
                value={editingFee.calculationMethod}
                onChange={(event) =>
                  setEditingFee({
                    ...editingFee,
                    calculationMethod: event.target.value as FeePolicyItem['calculationMethod'],
                  })
                }
              >
                <MenuItem value="FIXED_AMOUNT">Cố định mỗi kỳ</MenuItem>
                <MenuItem value="PER_KWH">Theo kWh</MenuItem>
                <MenuItem value="PER_M3">Theo m³</MenuItem>
                <MenuItem value="PER_PERSON">Theo người</MenuItem>
                <MenuItem value="PER_ROOM">Theo phòng</MenuItem>
                <MenuItem value="PER_BILLING_PERIOD">Theo kỳ hóa đơn</MenuItem>
              </TextField>
              <TextField
                type="number"
                label="Đơn giá"
                value={editingFee.unitPrice}
                onChange={(event) =>
                  setEditingFee({ ...editingFee, unitPrice: Number(event.target.value) })
                }
              />
              <TextField
                label="Đơn vị"
                value={editingFee.unit}
                onChange={(event) => setEditingFee({ ...editingFee, unit: event.target.value })}
              />
              <TextField
                select
                label="Phạm vi áp dụng"
                value={editingFee.applicationScope}
                onChange={(event) =>
                  setEditingFee({
                    ...editingFee,
                    applicationScope: event.target.value as FeePolicyItem['applicationScope'],
                  })
                }
              >
                <MenuItem value="LOCATION_WIDE">Toàn cơ sở</MenuItem>
                <MenuItem value="PER_ROOM">Theo phòng</MenuItem>
              </TextField>
              {editingFee.applicationScope === 'PER_ROOM' && (
                <TextField
                  select
                  label="Phòng áp dụng"
                  value={editingFee.targetRoomCode ?? ''}
                  onChange={(event) =>
                    setEditingFee({ ...editingFee, targetRoomCode: event.target.value })
                  }
                >
                  {rooms.map((room) => (
                    <MenuItem key={room.code} value={room.code}>
                      {room.code} · {roomTypes.find((item) => item.id === room.roomTypeId)?.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <TextField
                type="date"
                label="Hiệu lực từ"
                value={editingFee.effectiveDate}
                onChange={(event) =>
                  setEditingFee({ ...editingFee, effectiveDate: event.target.value })
                }
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                type="date"
                label="Hiệu lực đến"
                value={editingFee.effectiveTo ?? ''}
                onChange={(event) =>
                  setEditingFee({ ...editingFee, effectiveTo: event.target.value || null })
                }
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                multiline
                minRows={2}
                label="Mô tả"
                value={editingFee.description}
                onChange={(event) =>
                  setEditingFee({ ...editingFee, description: event.target.value })
                }
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingFee(null)}>Hủy</Button>
          <Button
            variant="contained"
            disabled={
              !editingFee?.name.trim() ||
              !editingFee.chargeCode?.trim() ||
              !editingFee.unit.trim() ||
              (editingFee.applicationScope === 'PER_ROOM' && !editingFee.targetRoomCode) ||
              editingFee.unitPrice < 0 ||
              (!!editingFee.effectiveTo && editingFee.effectiveTo < editingFee.effectiveDate)
            }
            onClick={() => {
              if (!editingFee) return;
              setFeePolicies((current) =>
                current.some((item) => item.id === editingFee.id)
                  ? current.map((item) => (item.id === editingFee.id ? editingFee : item))
                  : [...current, editingFee],
              );
              setEditingFee(null);
            }}
          >
            Lưu khoản phí
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!editingRule} onClose={() => setEditingRule(null)} fullWidth maxWidth="sm">
        <DialogTitle>Cấu hình nội quy của cơ sở</DialogTitle>
        <DialogContent>
          {editingRule && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                label="Tên nội quy"
                value={editingRule.name}
                onChange={(event) => setEditingRule({ ...editingRule, name: event.target.value })}
              />
              <TextField
                multiline
                minRows={4}
                label="Nội dung"
                value={editingRule.content}
                onChange={(event) =>
                  setEditingRule({ ...editingRule, content: event.target.value })
                }
              />
              <TextField
                type="date"
                label="Ngày hiệu lực"
                value={editingRule.effectiveDate}
                onChange={(event) =>
                  setEditingRule({ ...editingRule, effectiveDate: event.target.value })
                }
                slotProps={{ inputLabel: { shrink: true } }}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingRule(null)}>Hủy</Button>
          <Button
            variant="contained"
            disabled={!editingRule?.name.trim() || !editingRule.content.trim()}
            onClick={() => {
              if (!editingRule) return;
              setHouseRules((current) =>
                current.some((item) => item.id === editingRule.id)
                  ? current.map((item) => (item.id === editingRule.id ? editingRule : item))
                  : [...current, editingRule],
              );
              setEditingRule(null);
            }}
          >
            Lưu nội quy
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
