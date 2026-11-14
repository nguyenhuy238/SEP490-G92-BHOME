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
  rooms: Preparation['rooms'];
  blockedRooms: { id: string; label: string; codes: string[] }[];
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
  const seenFocus = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (seenFocus.current) setRevision((value) => value + 1);
      else seenFocus.current = true;
    }, []),
  );
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
        const blockedRooms: HoldingRooms['blockedRooms'] = [];
        for (let offset = 0; offset < candidates.length; offset += 4) {
          const batch = candidates.slice(offset, offset + 4);
          const ready = await Promise.all(
            batch.map(async (room) => {
              if (!api.holdingRoomReadiness)
                return {
                  ready: await api.holdingRoomReady(room.id, controller.signal),
                  codes: [],
                };
              const result = await api.holdingRoomReadiness(room.id, controller.signal);
              return {
                ready:
                  result.roomId === room.id &&
                  result.purpose === 'Holding' &&
                  result.status === 'Ready' &&
                  result.isReady === true &&
                  Array.isArray(result.blockers) &&
                  !result.blockers.length &&
                  Array.isArray(result.unverifiedConditions) &&
                  !result.unverifiedConditions.length,
                codes: [...(result.blockers ?? []), ...(result.unverifiedConditions ?? [])].map(
                  (finding) => finding.code,
                ),
              };
            }),
          );
          if (!active) return;
          rooms.push(...batch.filter((_, index) => ready[index]?.ready));
          batch.forEach((room, index) => {
            if (!ready[index]?.ready)
              blockedRooms.push({
                id: room.id,
                label: room.label,
                codes: ready[index]?.codes ?? [],
              });
          });
        }
        if (active) setData({ configuration, locations, rooms, blockedRooms });
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
  // Refresh server eligibility after using Owner Web or returning from the background.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setRevision((value) => value + 1);
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
