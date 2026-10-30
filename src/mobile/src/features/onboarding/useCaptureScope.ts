import { useEffect, useState } from 'react';
import { useSession } from '../../lib/SessionProvider';
import { errorMessage, type Named, type Resident } from '../../lib/api';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { captureService } from '../../services/captureService';

export function useCaptureScope() {
  const { api } = useSession();
  const { preview } = useWorkspace();
  const [location, setLocation] = useState('');
  const [room, setRoom] = useState('');
  const [locations, setLocations] = useState<Named[]>([]);
  const [rooms, setRooms] = useState<Named[]>([]);
  const [residents, setResidents] = useState<Resident[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const task = async () => {
      setLoading(true);
      setError('');
      try {
        const service = api ? captureService(api) : null;
        const nextLocations = preview
          ? [{ id: 'sample-dd', label: 'BHOME Đống Đa - Tòa B' }]
          : service
            ? await service.locations(controller.signal)
            : [];
        const [nextRooms, nextResidents] = location
          ? preview
            ? [
                [
                  { id: 'sample-301', label: '301', parentId: location },
                  { id: 'sample-302', label: '302', parentId: location },
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
              : [[], []]
          : [[], []];
        if (active) {
          setLocations(nextLocations);
          setRooms(nextRooms as Named[]);
          setResidents(nextResidents as Resident[]);
        }
      } catch (e) {
        if (active) setError(errorMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    };
    void task();
    return () => {
      active = false;
      controller.abort();
    };
  }, [api, preview, location, reload]);
  return {
    location,
    room,
    locations,
    rooms,
    residents,
    loading,
    error,
    selectLocation: (id: string) => {
      setLocation(id);
      setRoom('');
      setRooms([]);
      setResidents([]);
    },
    setRoom,
    reload: () => setReload((value) => value + 1),
  };
}
