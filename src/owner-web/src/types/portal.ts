import type { PropertyCommand, PropertyData } from '../features/property/model';
/** Demo view models only. Replace at repository boundary when .NET OpenAPI is finalized. */
export const resourceKinds = [
  'locations',
  'rooms',
  'room-types',
  'assets',
  'pricing',
  'staff',
  'schedules',
  'tasks',
  'tenants',
  'contracts',
  'handovers',
  'temporary-residence',
  'meters',
  'invoices',
  'payments',
  'debts',
  'incidents',
  'maintenance',
  'expenses',
  'public-content',
  'notifications',
] as const;
export type ResourceKind = (typeof resourceKinds)[number];
export interface PortalRecord {
  id: string;
  code: string;
  name: string;
  status: string;
  category: string;
  description: string;
  locationId: string;
  roomId: string;
  tenantId: string;
  contractId: string;
  invoiceId: string;
  incidentId: string;
  assetId: string;
  staffId: string;
  amount: number;
  paid: number;
  date: string;
  endDate: string;
  previous: number;
  current: number;
  signed: boolean;
  depositConfirmed: boolean;
  published: boolean;
  attributes: Record<string, string>;
}
export interface Scenario {
  id: string;
  name: string;
  occupancy: number;
  priceDelta: number;
  staffCost: number;
  maintenanceDelta: number;
  serviceFee: boolean;
  expansion: boolean;
}
export interface AuditEntry {
  id: string;
  at: string;
  action: string;
  kind: ResourceKind;
  recordId: string;
}
export interface DemoDatabase {
  property?: PropertyData;
  version: 1;
  records: Record<ResourceKind, PortalRecord[]>;
  scenarios: Scenario[];
  audit: AuditEntry[];
}
export interface ColumnDefinition {
  field: string;
  label: string;
  width?: number;
}
export interface FeatureDefinition {
  kind: ResourceKind;
  source: string;
  title: string;
  subtitle: string;
  group: string;
  action: string;
  columns: ColumnDefinition[];
  statuses: string[];
  tabs: string[];
  kpis: string[];
  images: string[];
}
export interface PortalRepository {
  executeProperty(command: PropertyCommand): Promise<void>;
  read(signal?: AbortSignal): Promise<DemoDatabase>;
  save(kind: ResourceKind, record: PortalRecord): Promise<PortalRecord>;
  remove(kind: ResourceKind, id: string): Promise<void>;
  transition(kind: ResourceKind, id: string, status: string): Promise<void>;
  reconcile(paymentId: string, invoiceId: string): Promise<void>;
  saveScenario(scenario: Scenario): Promise<void>;
  markAllRead(): Promise<void>;
  recordDebtFollowup(id: string, date: string, note: string): Promise<void>;
  reset(): Promise<void>;
}
