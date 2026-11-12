import { useEffect, useState } from 'react';
import {
  contractError,
  type ContractClient,
  type ContractConfiguration,
  type Preparation,
} from '../../../../../packages/client-core/src/contracts';

interface HoldingRooms {
  configuration: ContractConfiguration;
  locations: Preparation['locations'];
  rooms: Preparation['rooms'];
}

export function useHoldingPreparation(api: ContractClient, selectedRoomId = '') {
  const [data, setData] = useState<HoldingRooms | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selection, setSelection] = useState<{
    roomId: string;
    preparation?: Preparation;
    error?: string;
    loading: boolean;
    revision?: number;
  }>({ roomId: '', loading: false });
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function load() {
      setLoading(true);
      setError('');
      try {
        const [configuration, locations] = await Promise.all([
          api.configuration(controller.signal),
          api.locations(controller.signal),
        ]);
        const candidates: Preparation['rooms'] = [];
        let loaded = 0;
        for (let page = 1; ; page++) {
          const result = await api.holdingRooms(page, controller.signal);
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
              })),
          );
          loaded += result.items.length;
          if (!result.items.length || loaded >= result.totalCount) break;
        }
        const rooms: Preparation['rooms'] = [];
        for (let offset = 0; offset < candidates.length; offset += 4) {
          const batch = candidates.slice(offset, offset + 4);
          const ready = await Promise.all(
            batch.map((room) => api.holdingRoomReady(room.id, controller.signal)),
          );
          if (!active) return;
          rooms.push(...batch.filter((_, index) => ready[index]));
        }
        if (active) setData({ configuration, locations, rooms });
      } catch (e) {
        if (active) {
          setData(null);
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
  const room = data?.rooms.find((item) => item.id === selectedRoomId);
  const locationId = room?.locationId ?? '';
  useEffect(() => {
    if (!selectedRoomId || !locationId || loading) return;
    const controller = new AbortController();
    let active = true;
    void Promise.all([
      api.preparation(locationId, controller.signal),
      api.holdingRoomReady(selectedRoomId, controller.signal),
    ])
      .then(([preparation, ready]) => {
        if (!active) return;
        const validRoom = preparation.rooms.some(
          (item) =>
            item.id === selectedRoomId &&
            item.locationId === locationId &&
            item.status === 'Available',
        );
        setSelection(
          ready && validRoom
            ? { roomId: selectedRoomId, preparation, loading: false, revision }
            : {
                roomId: selectedRoomId,
                error: 'Phòng không còn đủ điều kiện giữ chỗ. Vui lòng chọn lại phòng.',
                loading: false,
                revision,
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
          });
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, selectedRoomId, locationId, loading, revision]);
  const current =
    selection.roomId === selectedRoomId && selection.revision === revision ? selection : null;
  const byLocation: Record<string, Preparation> =
    current?.preparation && locationId ? { [locationId]: current.preparation } : {};
  return {
    data: data ? { ...data, byLocation } : null,
    loading: loading || (!!room && (!current || current.loading)),
    error: error || (room ? (current?.error ?? '') : ''),
    reload: () => setRevision((value) => value + 1),
  };
}
