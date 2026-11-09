import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePortal } from '../app/PortalProvider';
import { usePropertyApi } from '../features/property-api/propertyApi';
import { isMockMode } from '../services/config';
import { resourceKinds, type DemoDatabase, type PortalRecord } from '../types/portal';

const record = ({ id, name, ...value }: Partial<PortalRecord> & Pick<PortalRecord, 'id' | 'name'>): PortalRecord => ({
  id,
  code: '',
  name,
  status: '',
  category: '',
  description: '',
  locationId: '',
  roomId: '',
  tenantId: '',
  contractId: '',
  invoiceId: '',
  incidentId: '',
  assetId: '',
  staffId: '',
  amount: 0,
  paid: 0,
  date: '',
  endDate: '',
  previous: 0,
  current: 0,
  signed: false,
  depositConfirmed: false,
  published: false,
  attributes: {},
  ...value,
});

const roomStatus = (status: number | string) => {
  const value = typeof status === 'string' && /^\d+$/.test(status) ? Number(status) : status;
  return ({ 0: 'AVAILABLE', 1: 'ON_HOLD', 2: 'OCCUPIED', 3: 'UNAVAILABLE' } as const)[
    value as 0 | 1 | 2 | 3
  ] ?? String(status);
};

export function usePortalData() {
  const { repository } = usePortal();
  const property = usePropertyApi();
  const mock = useQuery({
    queryKey: ['portal', 'mock'],
    queryFn: ({ signal }) => repository.read(signal),
    enabled: isMockMode,
  });
  const api = useQuery({
    queryKey: ['portal', 'api'],
    enabled: !isMockMode,
    queryFn: async ({ signal }): Promise<DemoDatabase> => {
      const [locations, rooms, assets] = await Promise.all([
        property.locations(signal),
        property.rooms(undefined, signal),
        property.assets(undefined, signal),
      ]);
      const records = resourceKinds.reduce((result, kind) => {
        result[kind] = [];
        return result;
      }, {} as DemoDatabase['records']);
      records.locations = locations.items.map((item, index) =>
        record({
          id: item.id,
          code: `CS-${String(index + 1).padStart(2, '0')}`,
          name: item.name,
          status: item.isActive ? 'Đang vận hành' : 'Tạm ngừng',
          attributes: { address: item.address, version: String(item.version) },
        }),
      );
      records.rooms = rooms.items.map((item) =>
        record({
          id: item.id,
          code: item.roomNumber,
          name: `Phòng ${item.roomNumber}`,
          locationId: item.locationId,
          category: item.roomTypeId ?? '',
          status: roomStatus(item.status),
          attributes: {
            floor: item.floor ?? '',
            capacity: String(item.capacity),
            version: String(item.version),
          },
        }),
      );
      records.assets = assets.items.map((item) =>
        record({
          id: item.id,
          code: item.code ?? '',
          name: item.name,
          locationId: item.locationId,
          roomId: item.roomId ?? '',
          category: item.category,
          status: String(item.status),
          description: item.condition,
          attributes: {
            commonArea: item.commonArea ?? '',
            version: String(item.version),
          },
        }),
      );
      return { version: 1, records, scenarios: [], audit: [] };
    },
  });
  return isMockMode ? mock : api;
}
export function usePortalAction() {
  const queryClient = useQueryClient();
  const { notify } = usePortal();
  return useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['portal'] });
      notify('Đã lưu thay đổi vào dữ liệu demo.');
    },
    onError: (error) =>
      notify(
        error instanceof Error ? error.message : 'Không thể lưu dữ liệu. Vui lòng thử lại.',
        true,
      ),
  });
}
