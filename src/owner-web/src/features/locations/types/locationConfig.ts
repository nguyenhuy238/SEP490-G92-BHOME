// Initial Location Configuration TypeScript definitions for BHOME Owner Web

export interface RoomTypeDraft {
  id: string;
  name: string;
  code: string;
  area: number; // m²
  maxOccupants: number;
  defaultRate: number; // VND/month
  description: string;
  facilities: string[];
  status: 'ACTIVE' | 'DRAFT' | 'INACTIVE';
}

export interface GeneratedRoomDraft {
  code: string;
  floor: number;
  roomTypeId: string;
  customRate?: number;
  customArea?: number;
  status: 'AVAILABLE' | 'UNAVAILABLE';
}

export interface AssetCatalogItem {
  id: string;
  name: string;
  category:
    | 'Appliances'
    | 'Furniture'
    | 'Sanitary'
    | 'Electronics'
    | 'Điện máy'
    | 'Nội thất'
    | 'Thiết bị vệ sinh';
  defaultCost: number;
  iconName: string;
  description: string;
}

export interface RoomTypeAssetRequirement {
  catalogId: string;
  quantity: number;
  isMandatory: boolean;
}

export interface RoomAssetAssignmentDraft {
  roomCode: string;
  catalogId: string;
  quantity: number;
  condition: 'Active' | 'Needs Repair' | 'Under Repair';
  source: 'TEMPLATE' | 'OVERRIDE';
}

export interface RentalRateItem {
  roomCode: string;
  roomTypeId: string;
  floor: number;
  defaultRate: number;
  appliedRate: number;
  source: 'ROOM_TYPE_DEFAULT' | 'MANUAL_OVERRIDE';
  effectiveDate: string;
}

export type FeeCalculationMethod =
  'FIXED_AMOUNT' | 'PER_KWH' | 'PER_M3' | 'PER_PERSON' | 'PER_ROOM' | 'PER_BILLING_PERIOD';

export interface FeePolicyItem {
  id: string;
  name: string;
  type:
    | 'ELECTRICITY'
    | 'WATER'
    | 'ENVIRONMENTAL_CLEANING'
    | 'SECURITY'
    | 'INTERNET'
    | 'PARKING'
    | 'OTHER';
  calculationMethod: FeeCalculationMethod;
  unitPrice: number;
  unit: string;
  applicationScope: 'LOCATION_WIDE' | 'PER_ROOM' | 'PER_ROOM_TYPE';
  effectiveDate: string;
  description: string;
  isRegulatoryControlled?: boolean; // For electricity & water tariffs
}

export type PolicyCategory =
  | 'ACCESS_HOURS'
  | 'VISITOR_RULES'
  | 'SHARED_FACILITY'
  | 'CLEANING'
  | 'SECURITY'
  | 'FIRE_SAFETY'
  | 'ASSET_USAGE'
  | 'DEPOSIT_POLICIES'
  | 'OTHER_OPERATIONS';

export interface PolicyVersionRecord {
  version: string;
  value: string;
  effectiveDate: string;
  status: 'ACTIVE' | 'SCHEDULED' | 'HISTORICAL' | 'DRAFT';
  createdBy?: string;
  note?: string;
}

export interface HouseRuleItem {
  id: string;
  name: string;
  category: PolicyCategory;
  content: string;
  effectiveDate: string;
  status: 'ACTIVE' | 'SCHEDULED' | 'DRAFT';
  version: string;
  isAppliedToContracts: boolean; // If true, triggers versioning flow
  history?: PolicyVersionRecord[];
}

export interface OperationalHistoryItem {
  id: string;
  date: string;
  event:
    | 'ASSET_INSTALLED'
    | 'ASSET_REPAIRED'
    | 'ASSET_REPLACED'
    | 'CONDITION_UPDATED'
    | 'MAINTENANCE_COMPLETED'
    | 'POLICY_UPDATED'
    | 'ROOM_SETUP_COMPLETED';
  relatedAsset?: string;
  roomCode?: string;
  condition?:
    | 'Good'
    | 'Fair'
    | 'Needs Repair'
    | 'Repaired'
    | 'Active'
    | 'Tốt'
    | 'Hoạt động tốt'
    | 'Bình thường';
  cost?: number;
  description: string;
  actor: string;
}

export interface SetupWizardState {
  step: number;
  mode: 'SCRATCH' | 'COPY';
  sourceLocationId?: string;
  locationInfo: {
    name: string;
    code: string;
    address: string;
    floors: number;
    phone: string;
    email: string;
    description: string;
    operationalStatus: 'ACTIVE' | 'PREPARING' | 'MAINTENANCE';
  };
  roomTypes: RoomTypeDraft[];
  rooms: GeneratedRoomDraft[];
  assetCatalog: AssetCatalogItem[];
  roomTypeTemplates: Record<string, RoomTypeAssetRequirement[]>;
  roomAssignments: RoomAssetAssignmentDraft[];
  rentalRates: RentalRateItem[];
  feePolicies: FeePolicyItem[];
  houseRules: HouseRuleItem[];
}

export type CopyConfigurationGroup =
  | 'ROOM_TYPES'
  | 'ASSET_TEMPLATES'
  | 'RENTAL_RATES'
  | 'FEE_POLICIES'
  | 'HOUSE_RULES'
  | 'OPERATING_POLICIES'
  | 'BILLING_SETTINGS'
  | 'ROOM_STRUCTURE_TEMPLATES';

export type CopyConflictStatus = 'NEW' | 'ALREADY_EXISTS' | 'DIFFERENT' | 'REQUIRES_REVIEW';
export type CopyActionChoice = 'COPY' | 'SKIP' | 'CREATE_NEW_VERSION';

export interface CopyGroupItemPreview {
  id: string;
  name: string;
  sourceValue: string;
  destinationValue: string;
  conflictStatus: CopyConflictStatus;
  action: CopyActionChoice;
}

export interface CopyGroupPreview {
  group: CopyConfigurationGroup;
  title: string;
  count: number;
  items: CopyGroupItemPreview[];
}
