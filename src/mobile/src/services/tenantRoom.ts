import type {
  ContractPage,
  ContractView,
  HandoverView,
} from '../../../../packages/client-core/src/contracts';
import { dateOnly, guid } from '../../../../packages/client-core/src/contracts';
import { MobileApiError, type MobileApi } from '../lib/api';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object';
const strings = (value: ObjectValue, keys: string[]) =>
  keys.every((key) => typeof value[key] === 'string');
const money = (value: unknown) => typeof value === 'string' && /^\d+$/.test(value);
const date = (value: unknown) => {
  try {
    return typeof value === 'string' && dateOnly(value) === value;
  } catch {
    return false;
  }
};
const identifier = (value: unknown) => {
  try {
    return typeof value === 'string' && guid(value) === value;
  } catch {
    return false;
  }
};
function invalid(): never {
  throw new MobileApiError(502, 'invalid_response');
}
function summary(value: unknown): value is ObjectValue {
  return (
    object(value) &&
    identifier(value.id) &&
    strings(value, ['roomNumber', 'locationName', 'status', 'kind']) &&
    ['Main', 'Renewal', 'Holding'].includes(value.kind as string) &&
    date(value.startDate) &&
    date(value.endDate) &&
    money(value.monthlyRent)
  );
}
export async function loadTenantRoomPage(
  api: MobileApi,
  path: string,
  signal: AbortSignal,
): Promise<ContractPage> {
  const value = await api.request<unknown>(path, { signal });
  const page = Number(new URLSearchParams(path.split('?')[1]).get('page'));
  if (
    !object(value) ||
    !Array.isArray(value.items) ||
    !value.items.every(summary) ||
    value.page !== page ||
    value.pageSize !== 20 ||
    !Number.isSafeInteger(value.totalCount) ||
    (value.totalCount as number) < value.items.length
  )
    invalid();
  return value as unknown as ContractPage;
}
export async function loadTenantRoomContract(
  api: MobileApi,
  path: string,
  signal: AbortSignal,
): Promise<ContractView> {
  const value = await api.request<unknown>(path, { signal });
  if (
    !summary(value) ||
    value.id !== path.split('/').pop() ||
    !money(value.requiredDeposit) ||
    (value.occupants != null &&
      (!Array.isArray(value.occupants) ||
        !value.occupants.every(
          (person) =>
            object(person) &&
            strings(person, ['id', 'label']) &&
            typeof person.representative === 'boolean',
        )))
  )
    invalid();
  if (value.status !== 'Active' || value.kind === 'Holding')
    throw new MobileApiError(409, 'stale_version');
  return value as unknown as ContractView;
}
export async function loadTenantRoomHandover(
  api: MobileApi,
  path: string,
  signal: AbortSignal,
): Promise<HandoverView | null> {
  // Only used after a successful, account-scoped contract detail lookup.
  let value: unknown;
  try {
    value = await api.request<unknown>(path, { signal });
  } catch (error) {
    if (error instanceof MobileApiError && error.status === 404) return null;
    throw error;
  }
  if (value === null) return null;
  if (
    !object(value) ||
    typeof value.status !== 'string' ||
    !['Draft', 'Disputed', 'Confirmed'].includes(value.status) ||
    !object(value.snapshot)
  )
    invalid();
  const snapshot = value.snapshot;
  if (
    !date(snapshot.date) ||
    !strings(snapshot, ['roomCondition', 'keysAndAccess']) ||
    !Array.isArray(snapshot.assets) ||
    !snapshot.assets.every(
      (asset) => object(asset) && strings(asset, ['id', 'name', 'observedCondition']),
    ) ||
    ![snapshot.electricity, snapshot.water].every(
      (reading) =>
        object(reading) &&
        typeof reading.value === 'string' &&
        /^\d+(?:\.\d+)?$/.test(reading.value),
    ) ||
    !(
      value.tenantConfirmedAt === null ||
      (typeof value.tenantConfirmedAt === 'string' &&
        Number.isFinite(Date.parse(value.tenantConfirmedAt)))
    )
  )
    invalid();
  return value as unknown as HandoverView;
}
