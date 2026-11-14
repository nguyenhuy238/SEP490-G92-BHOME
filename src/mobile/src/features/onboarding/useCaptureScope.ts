import { useCallback, useEffect, useState } from 'react';
import { useSession } from '../../lib/SessionProvider';
import { errorMessage, type Named, type Resident } from '../../lib/api';
import { conciseMessage, showError } from '../../lib/toast';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { captureService } from '../../services/captureService';

export function useCaptureScope({
  autoSelectAssignedLocation = false,
  inlineErrors = false,
  initialLocationId = '',
} = {}) {
  const { api } = useSession();
  const { preview } = useWorkspace();
  const [location, setLocation] = useState('');
  const [room, setRoom] = useState('');
  const [locations, setLocations] = useState<Named[]>([]);
  const [rooms, setRooms] = useState<Named[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [locationsLoading, setLocationsLoading] = useState(false);
  const [roomsLoading, setRoomsLoading] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [roomError, setRoomError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function loadLocations() {
      setLocationsLoading(true);
      setLocationError('');
      try {
        const next = preview
          ? [{ id: 'sample-dd', label: 'BHOME Đống Đa - Tòa B' }]
          : api
            ? await captureService(api).locations(controller.signal)
            : [];
        if (!active) return;
        setLocations(next);
        setLocation((current) =>
          next.some((item) => item.id === current)
            ? current
            : next.some((item) => item.id === initialLocationId)
              ? initialLocationId
              : autoSelectAssignedLocation && next.length === 1
                ? next[0].id
                : '',
        );
      } catch (e) {
        if (active) {
          setLocations([]);
          setLocation('');
          const message = conciseMessage(errorMessage(e));
          setLocationError(message);
          if (!inlineErrors) showError(message);
        }
      } finally {
        if (active) setLocationsLoading(false);
      }
    }
    void loadLocations();
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, preview, revision, autoSelectAssignedLocation, inlineErrors, initialLocationId]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    async function loadRooms() {
      setRoomsLoading(true);
      setRoomError('');
      setRooms([]);
      setResidents([]);
      try {
        const service = api ? captureService(api) : null;
        const [nextRooms, nextResidents]: [Named[], Resident[]] = !location
          ? [[], []]
          : preview
            ? [
                [
                  {
                    id: 'sample-301',
                    label: '301',
                    parentId: location,
                    status: 'Occupied',
                  },
                  {
                    id: 'sample-302',
                    label: '302',
                    parentId: location,
                    status: 'Available',
                  },
                ],
                [
                  {
                    id: 'sample-resident',
                    roomId: 'sample-301',
                    displayLabel: 'Người ở mẫu 01',
                    verificationStatus: 0,
                  },
                ],
              ]
            : service
              ? await Promise.all([
                  service.rooms(location, controller.signal),
                  service.residents(location, controller.signal),
                ])
              : [[], []];
        if (!active) return;
        setRooms(nextRooms);
        setResidents(nextResidents);
        setRoom((current) => (nextRooms.some((item) => item.id === current) ? current : ''));
      } catch (e) {
        if (active) {
          setRoom('');
          const message = conciseMessage(errorMessage(e));
          setRoomError(message);
          if (!inlineErrors) showError(message);
        }
      } finally {
        if (active) setRoomsLoading(false);
      }
    }
    void loadRooms();
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, preview, location, revision, inlineErrors]);

  const selectLocation = useCallback((id: string) => {
    setLocation(id);
    setRoom('');
    setRooms([]);
    setResidents([]);
  }, []);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return {
    location,
    room,
    locations,
    rooms,
    residents,
    loading: locationsLoading || roomsLoading,
    error: locationError || roomError,
    selectLocation,
    setRoom,
    reload,
  };
}
