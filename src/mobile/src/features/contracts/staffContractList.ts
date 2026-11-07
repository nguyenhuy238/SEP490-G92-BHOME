import {
  contractStates,
  type ContractClient,
  type ContractSummary,
} from '../../../../../packages/client-core/src/contracts';

export const staffContractTabs = [
  { id: '', label: 'Tất cả', statuses: [...contractStates] as string[] },
  { id: 'Draft', label: 'Bản nháp', statuses: ['Draft'] },
  { id: 'PendingSigning', label: 'Chờ ký', statuses: ['PendingSigning'] },
  { id: 'PendingActivation', label: 'Chờ kích hoạt', statuses: ['PendingActivation'] },
  { id: 'Active', label: 'Đang hiệu lực', statuses: ['Active'] },
  { id: 'closed', label: 'Đã kết thúc', statuses: ['Terminated', 'Superseded', 'Cancelled'] },
];
export const staffContractSorts = [
  { id: 'newest', label: 'Ngày thuê mới nhất' },
  { id: 'oldest', label: 'Ngày thuê cũ nhất' },
  { id: 'rent-asc', label: 'Giá thuê tăng dần' },
  { id: 'rent-desc', label: 'Giá thuê giảm dần' },
];
export const staffContractPageSize = 5;
export interface StaffContractListView {
  status: string;
  search: string;
  sort: string;
  page: number;
}
export const defaultStaffContractListView: StaffContractListView = {
  status: '',
  search: '',
  sort: 'newest',
  page: 1,
};

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
) {
  const query = searchable(search.trim());
  const statuses = staffContractTabs.find((tab) => tab.id === status)?.statuses ?? [];
  const filtered = contracts.filter(
    (contract) =>
      statuses.includes(contract.status) &&
      (!query ||
        searchable(
          [contract.roomNumber, contract.id, contract.locationName, contract.kind].join(' '),
        ).includes(query)),
  );
  filtered.sort((a, b) => {
    const difference = sort.startsWith('rent-')
      ? compareRent(a.monthlyRent, b.monthlyRent) * (sort === 'rent-desc' ? -1 : 1)
      : a.startDate.localeCompare(b.startDate) * (sort === 'oldest' ? 1 : -1);
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
