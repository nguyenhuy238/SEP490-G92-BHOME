import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import {
  contractError,
  type ContractClient,
  type ContractConfiguration,
  type Preparation,
} from '../../../../../packages/client-core/src/contracts';

interface HoldingRooms {
  configuration: ContractConfiguration;
  locations: Preparation['locations'];
  rooms: (Preparation['rooms'][number] & { capacity?: number })[];
  blockedRooms: { id: string; label: string; codes: string[] }[];
}

const holdingRoomBlockers: Record<string, string> = {
  RENT_POLICY_MISSING: 'Phòng chưa cấu hình giá thuê. Owner cần cập nhật giá phòng.',
  PROTECTED_PENDING_CONTRACT:
    'Phòng đã có hợp đồng đang xử lý có chữ ký hoặc tiền cọc. Hãy mở hợp đồng đó để tiếp tục.',
  ACTIVE_TENANCY_CONFLICT: 'Phòng đã có hợp đồng đang hiệu lực hoặc đang được giữ chỗ.',
  RESIDENT_OBLIGATION: 'Phòng đang có người ở. Chưa thể tạo giữ chỗ mới.',
  ASSET_MAINTENANCE_REQUIRED:
    'Phòng có tài sản cần sửa chữa. Owner cần kiểm tra trước khi giữ chỗ.',
  ROOM_UNAVAILABLE: 'Phòng hiện không khả dụng để giữ chỗ.',
  LOCATION_INACTIVE: 'Cơ sở hiện không hoạt động.',
};

export function useHoldingPreparation(api: ContractClient, selectedRoomId = '') {
  const [data, setData] = useState<HoldingRooms | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selectionRevision, setSelectionRevision] = useState(0);
  const selectedRoom = useRef(selectedRoomId);
  useEffect(() => {
    selectedRoom.current = selectedRoomId;
  }, [selectedRoomId]);
  const [selection, setSelection] = useState<{
    roomId: string;
    preparation?: Preparation;
    error?: string;
    loading: boolean;
    codes?: string[];
    revision?: number;
    selectionRevision?: number;
  }>({ roomId: '', loading: false });
  const seenFocus = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (seenFocus.current) {
        if (selectedRoom.current) setSelectionRevision((value) => value + 1);
        else setRevision((value) => value + 1);
      } else seenFocus.current = true;
    }, []),
  );
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [configuration, locations, firstPage] = await Promise.all([
          api.configuration(controller.signal),
          api.locations(controller.signal),
          api.holdingRooms(1, controller.signal),
        ]);
        const candidates: HoldingRooms['rooms'] = [];
        let loaded = 0;
        for (let page = 1; ; page++) {
          const result = page === 1 ? firstPage : await api.holdingRooms(page, controller.signal);
          if (!active) return;
          candidates.push(
            ...result.items
              .filter(
                (room) =>
                  room.status === 0 &&
                  locations.some((location) => location.id === room.locationId),
              )
              .map((room) => ({
                id: room.id,
                locationId: room.locationId,
                label: room.roomNumber,
                status: 'Available',
                capacity: room.capacity,
              })),
          );
          loaded += result.items.length;
          if (!result.items.length || loaded >= result.totalCount) break;
        }
        // Listing available rooms must not wait for N readiness requests.
        // Validate only the selected room below; creation rechecks eligibility on the server.
        if (active) setData({ configuration, locations, rooms: candidates, blockedRooms: [] });
      } catch (e) {
        if (active) {
          // Keep the current wizard mounted on a failed background refresh.
          // The error still prevents submitting until the server can be checked.
          setError(contractError(e));
        }
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, revision]);
  // Refresh server eligibility after using Owner Web or returning from the background.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (selectedRoom.current) setSelectionRevision((value) => value + 1);
        else setRevision((value) => value + 1);
      }
    });
    return () => subscription.remove();
  }, []);
  const room = data?.rooms.find((item) => item.id === selectedRoomId);
  const locationId = room?.locationId ?? '';
  useEffect(() => {
    if (!selectedRoomId || !locationId || loading) return;
    const controller = new AbortController();
    let active = true;
    void Promise.all([
      api.preparation(locationId, controller.signal),
      api.holdingRoomReadiness
        ? api.holdingRoomReadiness(selectedRoomId, controller.signal)
        : api.holdingRoomReady(selectedRoomId, controller.signal),
    ])
      .then(([preparation, ready]) => {
        if (!active) return;
        const eligible =
          typeof ready === 'boolean'
            ? ready
            : ready.roomId === selectedRoomId &&
              ready.purpose === 'Holding' &&
              ready.status === 'Ready' &&
              ready.isReady === true &&
              Array.isArray(ready.blockers) &&
              !ready.blockers.length &&
              Array.isArray(ready.unverifiedConditions) &&
              !ready.unverifiedConditions.length;
        const codes =
          typeof ready === 'boolean'
            ? []
            : [...(ready.blockers ?? []), ...(ready.unverifiedConditions ?? [])].map(
                (finding) => finding.code,
              );
        const validRoom = preparation.rooms.some(
          (item) =>
            item.id === selectedRoomId &&
            item.locationId === locationId &&
            item.status === 'Available',
        );
        setSelection(
          eligible && validRoom
            ? { roomId: selectedRoomId, preparation, loading: false, revision, selectionRevision }
            : {
                roomId: selectedRoomId,
                error:
                  codes
                    .map((code) => holdingRoomBlockers[code])
                    .filter(Boolean)
                    .join('\n') ||
                  'Phòng không còn đủ điều kiện giữ chỗ. Owner cần kiểm tra điều kiện sử dụng phòng.',
                codes,
                loading: false,
                revision,
                selectionRevision,
              },
        );
      })
      .catch((e) => {
        if (active)
          setSelection({
            roomId: selectedRoomId,
            error: contractError(e),
            loading: false,
            revision,
            selectionRevision,
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, selectedRoomId, locationId, loading, revision, selectionRevision]);
  const current =
    selection.roomId === selectedRoomId &&
    selection.revision === revision &&
    selection.selectionRevision === selectionRevision
      ? selection
      : null;
  const byLocation: Record<string, Preparation> =
    current?.preparation && locationId ? { [locationId]: current.preparation } : {};
  return {
    data: data
      ? {
          ...data,
          byLocation,
          blockedRooms:
            room && current?.codes?.length
              ? [{ id: room.id, label: room.label, codes: current.codes }]
              : [],
        }
      : null,
    catalogLoading: loading,
    selectionBlocked: !!current?.error && current.codes !== undefined,
    loading: loading || (!!room && (!current || current.loading)),
    error: error || (room ? (current?.error ?? '') : ''),
    reload: () => setRevision((value) => value + 1),
  };
}
