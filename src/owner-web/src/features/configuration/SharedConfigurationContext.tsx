import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

export type ConfigurationSource =
  'Shared Template' | 'Copied from Location' | 'Custom Configuration';

export interface RoomTemplate {
  id: string;
  name: string;
  area: number;
  capacity: number;
  rate: number;
  description: string;
  facilities: string[];
  assetTemplateId?: string;
  locationsUsing: number;
}

export interface AssetCatalogEntry {
  id: string;
  name: string;
  category: string;
  description: string;
  referencePrice: number;
  unit: string;
  status: 'Active' | 'Draft';
}

export interface AssetTemplate {
  id: string;
  name: string;
  roomType: string;
  description: string;
  items: { assetId: string; quantity: number; required: boolean }[];
  locationsUsing: number;
}

export interface FeeTemplate {
  id: string;
  name: string;
  category: string;
  method: string;
  price: number;
  unit: string;
  description: string;
  scope: string;
  locationsUsing: number;
  version: number;
  status: 'Draft' | 'Active' | 'Scheduled';
  effectiveDate: string;
}

export interface PolicyTemplate {
  id: string;
  name: string;
  category: string;
  summary: string;
  content: string;
  status: 'Draft' | 'Active' | 'Scheduled';
  locationsUsing: number;
  version: number;
  effectiveDate: string;
}

export interface AppliedConfiguration {
  roomTemplateIds: string[];
  assetTemplateIds: string[];
  feeTemplateIds: string[];
  policyTemplateIds: string[];
  source: ConfigurationSource;
  sourceLocation?: string;
  overrides: Record<string, number | string>;
  rooms: { code: string; floor: number; roomTemplateId: string }[];
}

interface SharedConfigurationValue {
  roomTemplates: RoomTemplate[];
  assetCatalog: AssetCatalogEntry[];
  assetTemplates: AssetTemplate[];
  feeTemplates: FeeTemplate[];
  policyTemplates: PolicyTemplate[];
  appliedByLocation: Record<string, AppliedConfiguration>;
  addRoomTemplate: (value: Omit<RoomTemplate, 'id' | 'locationsUsing'>) => void;
  addAsset: (value: Omit<AssetCatalogEntry, 'id'>) => void;
  addAssetTemplate: (value: Omit<AssetTemplate, 'id' | 'locationsUsing'>) => void;
  addFeeTemplate: (
    value: Omit<FeeTemplate, 'id' | 'locationsUsing' | 'version' | 'status'>,
  ) => void;
  addPolicyTemplate: (
    value: Omit<PolicyTemplate, 'id' | 'locationsUsing' | 'version' | 'status'>,
  ) => void;
  duplicateTemplate: (kind: 'room' | 'fee' | 'policy', id: string) => void;
  updateTemplate: (
    kind: 'room' | 'asset' | 'assetTemplate' | 'fee' | 'policy',
    id: string,
    changes: Record<string, unknown>,
  ) => void;
  applyTemplate: (
    kind: 'room' | 'asset' | 'fee' | 'policy',
    templateId: string,
    locationId: string,
  ) => void;
  setAppliedConfiguration: (locationId: string, value: AppliedConfiguration) => void;
  copyConfiguration: (sourceId: string, destinationId: string, groups: string[]) => void;
  setOverride: (locationId: string, key: string, value: number | string) => void;
  saveLocationItemAsTemplate: (
    kind: 'room' | 'asset' | 'fee' | 'policy',
    name: string,
    description: string,
  ) => void;
  createFeeVersion: (id: string, price: number, effectiveDate: string) => void;
  createPolicyVersion: (id: string, content: string, effectiveDate: string) => void;
}

const initialRooms: RoomTemplate[] = [
  {
    id: 'rt-studio',
    name: 'Studio tiêu chuẩn',
    area: 25,
    capacity: 2,
    rate: 5_500_000,
    description: 'Thiết kế studio tối ưu với phòng tắm riêng và khu bếp nhỏ.',
    facilities: ['Phòng tắm riêng', 'Khu bếp nhỏ', 'Máy lạnh'],
    assetTemplateId: 'at-studio',
    locationsUsing: 3,
  },
  {
    id: 'rt-balcony',
    name: 'Studio có ban công',
    area: 29,
    capacity: 2,
    rate: 6_200_000,
    description: 'Phòng studio có ban công riêng và thông gió tự nhiên.',
    facilities: ['Ban công', 'Phòng tắm riêng', 'Khu bếp nhỏ'],
    assetTemplateId: 'at-studio',
    locationsUsing: 2,
  },
  {
    id: 'rt-single',
    name: 'Phòng đơn',
    area: 18,
    capacity: 1,
    rate: 3_800_000,
    description: 'Phòng nhỏ gọn dành cho một khách thuê với các tiện nghi thiết yếu.',
    facilities: ['Phòng tắm riêng', 'Máy lạnh'],
    locationsUsing: 1,
  },
  {
    id: 'rt-double',
    name: 'Phòng đôi',
    area: 32,
    capacity: 4,
    rate: 7_000_000,
    description: 'Phòng ở linh hoạt dành cho nhóm nhỏ hoặc hộ gia đình.',
    facilities: ['Phòng tắm riêng', 'Khu bếp nhỏ', 'Tủ quần áo lớn'],
    locationsUsing: 1,
  },
];

const initialAssets: AssetCatalogEntry[] = [
  ['ac', 'Máy lạnh', 'Điện máy', 8_500_000, 'cái'],
  ['fridge', 'Tủ lạnh', 'Điện máy', 6_200_000, 'cái'],
  ['tv', 'Smart TV', 'Điện tử', 7_500_000, 'cái'],
  ['washer', 'Máy giặt', 'Điện máy', 6_800_000, 'cái'],
  ['cooker', 'Bếp từ', 'Điện máy', 1_400_000, 'cái'],
  ['bed', 'Giường ngủ', 'Nội thất', 4_500_000, 'bộ'],
  ['wardrobe', 'Tủ quần áo', 'Nội thất', 3_800_000, 'cái'],
  ['heater', 'Máy nước nóng', 'Điện máy', 2_900_000, 'cái'],
  ['toilet', 'Bồn cầu', 'Thiết bị vệ sinh', 2_800_000, 'cái'],
  ['shower', 'Bộ vòi sen', 'Thiết bị vệ sinh', 1_500_000, 'bộ'],
].map(([id, name, category, price, unit]) => ({
  id: `asset-${id}`,
  name: String(name),
  category: String(category),
  description: `Định nghĩa ${String(name).toLowerCase()} dùng chung. Tài sản vật lý thực tế được phân bổ riêng.`,
  referencePrice: Number(price),
  unit: String(unit),
  status: 'Active' as const,
}));

const initialAssetTemplates: AssetTemplate[] = [
  {
    id: 'at-studio',
    name: 'Tài sản studio tiêu chuẩn',
    roomType: 'Studio tiêu chuẩn',
    description: 'Gói trang thiết bị bàn giao tiêu chuẩn cho phòng studio.',
    locationsUsing: 3,
    items: [
      { assetId: 'asset-ac', quantity: 1, required: true },
      { assetId: 'asset-fridge', quantity: 1, required: true },
      { assetId: 'asset-bed', quantity: 1, required: true },
      { assetId: 'asset-heater', quantity: 1, required: true },
      { assetId: 'asset-wardrobe', quantity: 1, required: false },
    ],
  },
  {
    id: 'at-double',
    name: 'Trang bị thiết yếu phòng đôi',
    roomType: 'Phòng đôi',
    description: 'Gói trang thiết bị phù hợp cho phòng đôi.',
    locationsUsing: 1,
    items: [
      { assetId: 'asset-ac', quantity: 2, required: true },
      { assetId: 'asset-bed', quantity: 2, required: true },
      { assetId: 'asset-wardrobe', quantity: 2, required: true },
      { assetId: 'asset-heater', quantity: 1, required: true },
    ],
  },
];

const initialFees: FeeTemplate[] = [
  [
    'fee-rent',
    'Giá thuê studio',
    'Giá thuê',
    'Cố định hằng tháng',
    5_500_000,
    'VND / tháng',
    'Theo loại phòng',
  ],
  [
    'fee-electricity',
    'Tiền điện tiêu chuẩn',
    'Điện',
    'Theo chỉ số đồng hồ',
    3_000,
    'VND / kWh',
    'Theo phòng',
  ],
  [
    'fee-water',
    'Tiền nước tiêu chuẩn',
    'Nước',
    'Theo chỉ số đồng hồ',
    25_000,
    'VND / m³',
    'Theo phòng',
  ],
  [
    'fee-cleaning',
    'Vệ sinh khu vực chung',
    'Vệ sinh',
    'Cố định hằng tháng',
    120_000,
    'VND / phòng',
    'Toàn cơ sở',
  ],
  [
    'fee-internet',
    'Internet dùng chung',
    'Internet',
    'Cố định hằng tháng',
    100_000,
    'VND / phòng',
    'Toàn cơ sở',
  ],
  ['fee-parking', 'Gửi xe máy', 'Giữ xe', 'Theo phương tiện', 150_000, 'VND / xe', 'Toàn cơ sở'],
].map(([id, name, category, method, price, unit, scope]) => ({
  id: String(id),
  name: String(name),
  category: String(category),
  method: String(method),
  price: Number(price),
  unit: String(unit),
  description:
    'Mẫu tham khảo. Cần xác nhận giá trị và ngày hiệu lực cho từng cơ sở trước khi sử dụng.',
  scope: String(scope),
  locationsUsing: 2,
  version: 1,
  status: 'Active' as const,
  effectiveDate: '2026-11-01',
}));

const initialPolicies: PolicyTemplate[] = [
  [
    'policy-access',
    'Giờ ra vào & giờ yên tĩnh',
    'Giờ ra vào',
    'Cư dân được ra vào 24/7; giờ yên tĩnh bắt đầu từ 22:30.',
  ],
  [
    'policy-visitor',
    'Quy định khách đến thăm',
    'Khách đến thăm',
    'Khách đến thăm được người thuê đăng ký và tuân thủ quy định khu vực chung.',
  ],
  [
    'policy-cleaning',
    'Vệ sinh khu vực chung',
    'Quy định vệ sinh',
    'Cư dân giữ hành lang thông thoáng và bỏ rác đúng nơi quy định.',
  ],
  [
    'policy-fire',
    'An toàn phòng cháy cơ bản',
    'Quy định PCCC',
    'Luôn giữ lối thoát hiểm thông thoáng và không can thiệp thiết bị PCCC.',
  ],
  [
    'policy-assets',
    'Bảo quản tài sản',
    'Sử dụng tài sản',
    'Tài sản được kiểm tra khi bàn giao và phải được sử dụng đúng hướng dẫn.',
  ],
].map(([id, name, category, summary], index) => ({
  id: String(id),
  name: String(name),
  category: String(category),
  summary: String(summary),
  content: String(summary),
  status: 'Active' as const,
  locationsUsing: index < 3 ? 3 : 2,
  version: 1,
  effectiveDate: '2026-11-01',
}));

const emptyApplied = (): AppliedConfiguration => ({
  roomTemplateIds: [],
  assetTemplateIds: [],
  feeTemplateIds: [],
  policyTemplateIds: [],
  source: 'Custom Configuration',
  overrides: {},
  rooms: [],
});
const SharedConfigurationContext = createContext<SharedConfigurationValue | null>(null);
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function SharedConfigurationProvider({ children }: { children: ReactNode }) {
  const [roomTemplates, setRoomTemplates] = useState(initialRooms);
  const [assetCatalog, setAssetCatalog] = useState(initialAssets);
  const [assetTemplates, setAssetTemplates] = useState(initialAssetTemplates);
  const [feeTemplates, setFeeTemplates] = useState(initialFees);
  const [policyTemplates, setPolicyTemplates] = useState(initialPolicies);
  const [appliedByLocation, setAppliedByLocation] = useState<Record<string, AppliedConfiguration>>({
    'loc-1': {
      roomTemplateIds: ['rt-studio', 'rt-balcony'],
      assetTemplateIds: ['at-studio'],
      feeTemplateIds: ['fee-electricity', 'fee-water', 'fee-internet'],
      policyTemplateIds: ['policy-access', 'policy-visitor', 'policy-fire'],
      source: 'Shared Template',
      overrides: { 'fee-water': 27_000 },
      rooms: [
        { code: '101', floor: 1, roomTemplateId: 'rt-studio' },
        { code: '102', floor: 1, roomTemplateId: 'rt-studio' },
        { code: '201', floor: 2, roomTemplateId: 'rt-balcony' },
      ],
    },
    'loc-2': {
      roomTemplateIds: ['rt-single'],
      assetTemplateIds: [],
      feeTemplateIds: ['fee-electricity'],
      policyTemplateIds: ['policy-access'],
      source: 'Copied from Location',
      sourceLocation: 'Location A',
      overrides: {},
      rooms: [{ code: '101', floor: 1, roomTemplateId: 'rt-single' }],
    },
  });

  const value = useMemo<SharedConfigurationValue>(
    () => ({
      roomTemplates,
      assetCatalog,
      assetTemplates,
      feeTemplates,
      policyTemplates,
      appliedByLocation,
      addRoomTemplate: (value) =>
        setRoomTemplates((items) => [...items, { ...value, id: id('rt'), locationsUsing: 0 }]),
      addAsset: (value) => setAssetCatalog((items) => [...items, { ...value, id: id('asset') }]),
      addAssetTemplate: (value) =>
        setAssetTemplates((items) => [...items, { ...value, id: id('at'), locationsUsing: 0 }]),
      addFeeTemplate: (value) =>
        setFeeTemplates((items) => [
          ...items,
          { ...value, id: id('fee'), locationsUsing: 0, version: 1, status: 'Draft' },
        ]),
      addPolicyTemplate: (value) =>
        setPolicyTemplates((items) => [
          ...items,
          { ...value, id: id('policy'), locationsUsing: 0, version: 1, status: 'Draft' },
        ]),
      duplicateTemplate: (kind, templateId) => {
        if (kind === 'room')
          setRoomTemplates((items) => {
            const item = items.find((entry) => entry.id === templateId);
            return item
              ? [
                  ...items,
                  { ...item, id: id('rt'), name: `${item.name} - Bản sao`, locationsUsing: 0 },
                ]
              : items;
          });
        if (kind === 'fee')
          setFeeTemplates((items) => {
            const item = items.find((entry) => entry.id === templateId);
            return item
              ? [
                  ...items,
                  {
                    ...item,
                    id: id('fee'),
                    name: `${item.name} - Bản sao`,
                    locationsUsing: 0,
                    status: 'Draft',
                  },
                ]
              : items;
          });
        if (kind === 'policy')
          setPolicyTemplates((items) => {
            const item = items.find((entry) => entry.id === templateId);
            return item
              ? [
                  ...items,
                  {
                    ...item,
                    id: id('policy'),
                    name: `${item.name} - Bản sao`,
                    locationsUsing: 0,
                    status: 'Draft',
                  },
                ]
              : items;
          });
      },
      updateTemplate: (kind, templateId, changes) => {
        if (kind === 'room')
          setRoomTemplates((items) =>
            items.map((item) =>
              item.id === templateId ? ({ ...item, ...changes } as RoomTemplate) : item,
            ),
          );
        if (kind === 'asset')
          setAssetCatalog((items) =>
            items.map((item) =>
              item.id === templateId ? ({ ...item, ...changes } as AssetCatalogEntry) : item,
            ),
          );
        if (kind === 'assetTemplate')
          setAssetTemplates((items) =>
            items.map((item) =>
              item.id === templateId ? ({ ...item, ...changes } as AssetTemplate) : item,
            ),
          );
        if (kind === 'fee')
          setFeeTemplates((items) =>
            items.map((item) =>
              item.id === templateId ? ({ ...item, ...changes } as FeeTemplate) : item,
            ),
          );
        if (kind === 'policy')
          setPolicyTemplates((items) =>
            items.map((item) =>
              item.id === templateId ? ({ ...item, ...changes } as PolicyTemplate) : item,
            ),
          );
      },
      applyTemplate: (kind, templateId, locationId) =>
        setAppliedByLocation((current) => {
          const next = {
            ...(current[locationId] ?? emptyApplied()),
            source: 'Shared Template' as const,
          };
          const key =
            kind === 'room'
              ? 'roomTemplateIds'
              : kind === 'asset'
                ? 'assetTemplateIds'
                : kind === 'fee'
                  ? 'feeTemplateIds'
                  : 'policyTemplateIds';
          next[key] = Array.from(new Set([...next[key], templateId]));
          return { ...current, [locationId]: next };
        }),
      setAppliedConfiguration: (locationId, config) =>
        setAppliedByLocation((current) => ({ ...current, [locationId]: config })),
      copyConfiguration: (sourceId, destinationId, groups) =>
        setAppliedByLocation((current) => {
          const source = current[sourceId] ?? emptyApplied();
          const destination = current[destinationId] ?? emptyApplied();
          return {
            ...current,
            [destinationId]: {
              ...destination,
              roomTemplateIds: groups.includes('Room Types')
                ? [...source.roomTemplateIds]
                : destination.roomTemplateIds,
              assetTemplateIds: groups.includes('Asset Templates')
                ? [...source.assetTemplateIds]
                : destination.assetTemplateIds,
              feeTemplateIds:
                groups.includes('Fee Policies') || groups.includes('Rental Rates')
                  ? [...source.feeTemplateIds]
                  : destination.feeTemplateIds,
              policyTemplateIds:
                groups.includes('House Rules') || groups.includes('Operating Policies')
                  ? [...source.policyTemplateIds]
                  : destination.policyTemplateIds,
              rooms: groups.includes('Room Structure Templates')
                ? [...source.rooms]
                : destination.rooms,
              source: 'Copied from Location',
              sourceLocation: sourceId,
            },
          };
        }),
      setOverride: (locationId, key, overrideValue) =>
        setAppliedByLocation((current) => ({
          ...current,
          [locationId]: {
            ...(current[locationId] ?? emptyApplied()),
            overrides: { ...(current[locationId]?.overrides ?? {}), [key]: overrideValue },
          },
        })),
      saveLocationItemAsTemplate: (kind, name, description) => {
        if (kind === 'room')
          setRoomTemplates((items) => [
            ...items,
            {
              id: id('rt'),
              name,
              area: 25,
              capacity: 2,
              rate: 5_000_000,
              description,
              facilities: ['Tiện nghi được cấu hình tại cơ sở'],
              locationsUsing: 0,
            },
          ]);
        if (kind === 'asset')
          setAssetTemplates((items) => [
            ...items,
            {
              id: id('at'),
              name,
              roomType: 'Cấu hình tại cơ sở',
              description,
              items: [],
              locationsUsing: 0,
            },
          ]);
        if (kind === 'fee')
          setFeeTemplates((items) => [
            ...items,
            {
              id: id('fee'),
              name,
              category: 'Phí dịch vụ khác',
              method: 'Cố định hằng tháng',
              price: 0,
              unit: 'VND / tháng',
              description,
              scope: 'Toàn cơ sở',
              locationsUsing: 0,
              version: 1,
              status: 'Draft',
              effectiveDate: '2026-11-04',
            },
          ]);
        if (kind === 'policy')
          setPolicyTemplates((items) => [
            ...items,
            {
              id: id('policy'),
              name,
              category: 'Chính sách vận hành khác',
              summary: description,
              content: description,
              status: 'Draft',
              locationsUsing: 0,
              version: 1,
              effectiveDate: '2026-11-04',
            },
          ]);
      },
      createFeeVersion: (templateId, price, effectiveDate) =>
        setFeeTemplates((items) =>
          items.map((item) =>
            item.id === templateId
              ? { ...item, price, effectiveDate, version: item.version + 1, status: 'Scheduled' }
              : item,
          ),
        ),
      createPolicyVersion: (templateId, content, effectiveDate) =>
        setPolicyTemplates((items) =>
          items.map((item) =>
            item.id === templateId
              ? {
                  ...item,
                  content,
                  summary: content.slice(0, 120),
                  effectiveDate,
                  version: item.version + 1,
                  status: 'Scheduled',
                }
              : item,
          ),
        ),
    }),
    [roomTemplates, assetCatalog, assetTemplates, feeTemplates, policyTemplates, appliedByLocation],
  );

  return (
    <SharedConfigurationContext.Provider value={value}>
      {children}
    </SharedConfigurationContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSharedConfiguration() {
  const value = useContext(SharedConfigurationContext);
  if (!value) throw new Error('SharedConfigurationProvider is required.');
  return value;
}
