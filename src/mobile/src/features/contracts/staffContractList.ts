import {
  type ContractClient,
  type ContractSummary,
} from '../../../../../packages/client-core/src/contracts';

export const staffContractTabs = [
  { id: '', label: 'Tất cả', dimension: 'all' },
  { id: 'Holding', label: 'Giữ chỗ', dimension: 'kind' },
  { id: 'Main', label: 'Chính thức', dimension: 'kind' },
  { id: 'Draft', label: 'Bản nháp', dimension: 'status' },
  { id: 'PendingSigning', label: 'Chờ ký', dimension: 'status' },
  { id: 'Active', label: 'Đang hiệu lực', dimension: 'status' },
  { id: 'PendingActivation', label: 'Chờ kích hoạt', dimension: 'status' },
  { id: 'closed', label: 'Đã kết thúc', dimension: 'status' },
];
export const staffContractSorts = [
  { id: 'newest', label: 'Ngày hợp đồng mới nhất' },
  { id: 'oldest', label: 'Ngày hợp đồng cũ nhất' },
  { id: 'rent-asc', label: 'Số tiền tăng dần' },
  { id: 'rent-desc', label: 'Số tiền giảm dần' },
];
export const staffContractPageSize = 5;
export interface StaffContractListView {
  kind: string;
  status: string;
  search: string;
  sort: string;
  page: number;
}
export const defaultStaffContractListView: StaffContractListView = {
  kind: '',
  status: '',
  search: '',
  sort: 'newest',
  page: 1,
};

export function staffContractTabSelected(
  tab: (typeof staffContractTabs)[number],
  view: StaffContractListView,
) {
  if (tab.dimension === 'all') return !view.kind && !view.status;
  return (tab.dimension === 'kind' ? view.kind : view.status) === tab.id;
}

export function staffContractTabView(
  tab: (typeof staffContractTabs)[number],
  view: StaffContractListView,
  toggle = false,
): StaffContractListView {
  if (tab.dimension === 'all') return { ...view, kind: '', status: '', page: 1 };
  const dimension = tab.dimension === 'kind' ? 'kind' : 'status';
  return { ...view, [dimension]: toggle && view[dimension] === tab.id ? '' : tab.id, page: 1 };
}

export async function loadStaffContracts(api: ContractClient, signal: AbortSignal) {
  const contracts = new Map<string, ContractSummary>();
  let expectedTotal: number | undefined;
  for (let page = 1; ; page++) {
    const batch = await api.list(page, '', '', signal);
    if (signal.aborted) throw Object.assign(new Error('Aborted'), { name: 'AbortError' });
    if (expectedTotal === undefined) expectedTotal = batch.totalCount;
    if (batch.totalCount !== expectedTotal)
      throw new Error('Danh sách hợp đồng đã thay đổi. Hãy tải lại.');
    const before = contracts.size;
    for (const contract of batch.items) contracts.set(contract.id, contract);
    if (contracts.size === expectedTotal) return [...contracts.values()];
    if (contracts.size > expectedTotal)
      throw new Error('Danh sách hợp đồng không nhất quán. Hãy tải lại.');
    // A partial/inconsistent API response must never produce misleading totals or an endless loop.
    if (!batch.items.length || contracts.size === before)
      throw new Error('Không tải đủ danh sách hợp đồng. Hãy tải lại.');
  }
}

export const staffContractKindLabel = (kind: string) =>
  kind === 'Holding'
    ? 'Giữ chỗ'
    : kind === 'Main'
      ? 'Chính thức'
      : kind === 'Renewal'
        ? 'Chính thức · Gia hạn'
        : kind === 'Addendum'
          ? 'Chính thức · Phụ lục'
          : kind;

export const staffContractAmount = (contract: ContractSummary) =>
  contract.kind === 'Holding' ? contract.requiredDeposit : contract.monthlyRent;

export function isMainOnboardingDraft(contract: Pick<ContractSummary, 'kind' | 'onboardingDraft'>) {
  return contract.kind === 'Main' && !!contract.onboardingDraft;
}

const closedStatuses = ['Terminated', 'Superseded', 'Cancelled', 'Expired', 'Converted', 'Applied'];
function matchesKind(contract: ContractSummary, kind: string) {
  return (
    !kind ||
    (kind === 'Main'
      ? ['Main', 'Renewal', 'Addendum'].includes(contract.kind)
      : contract.kind === kind)
  );
}

function searchable(value: string) {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase();
}
function compareRent(left: string, right: string) {
  const [a, af = ''] = left.split('.');
  const [b, bf = ''] = right.split('.');
  if (BigInt(a!) !== BigInt(b!)) return BigInt(a!) < BigInt(b!) ? -1 : 1;
  const places = Math.max(af.length, bf.length);
  return af.padEnd(places, '0').localeCompare(bf.padEnd(places, '0'));
}
export function staffContractPage(
  contracts: ContractSummary[],
  status: string,
  search: string,
  sort: string,
  page: number,
  kind = '',
) {
  const query = searchable(search.trim());
  const filtered = contracts.filter(
    (contract) =>
      matchesKind(contract, kind) &&
      (!status ||
        (status === 'closed'
          ? closedStatuses.includes(contract.status)
          : contract.status === status)) &&
      (!query ||
        searchable(
          [
            contract.roomNumber,
            contract.id,
            contract.locationName,
            contract.kind,
            staffContractKindLabel(contract.kind),
          ].join(' '),
        ).includes(query)),
  );
  filtered.sort((a, b) => {
    const difference = sort.startsWith('rent-')
      ? compareRent(staffContractAmount(a) ?? '0', staffContractAmount(b) ?? '0') *
        (sort === 'rent-desc' ? -1 : 1)
      : (a.kind === 'Holding' ? (a.holdingExpiresAt ?? '') : a.startDate).localeCompare(
          b.kind === 'Holding' ? (b.holdingExpiresAt ?? '') : b.startDate,
        ) * (sort === 'oldest' ? 1 : -1);
    return (
      difference ||
      a.roomNumber.localeCompare(b.roomNumber, 'vi', { numeric: true }) ||
      a.id.localeCompare(b.id)
    );
  });
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / staffContractPageSize));
  const current = Math.max(1, Math.min(page, pages));
  const start = (current - 1) * staffContractPageSize;
  return {
    items: filtered.slice(start, start + staffContractPageSize),
    total,
    pages,
    page: current,
    from: total ? start + 1 : 0,
    to: Math.min(start + staffContractPageSize, total),
  };
}

export function staffContractTone(status: string): 'neutral' | 'amber' | 'blue' | 'green' {
  if (status === 'Active') return 'green';
  if (status === 'PendingSigning') return 'amber';
  if (status === 'PendingActivation') return 'blue';
  return 'neutral';
}
