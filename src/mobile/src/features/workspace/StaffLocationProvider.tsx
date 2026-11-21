import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useSession } from '../../lib/SessionProvider';
import { errorMessage, type Named } from '../../lib/api';
import { conciseMessage } from '../../lib/toast';

interface StaffLocationContextValue {
  /** Only a Location present in the authenticated Staff assignment response is selectable. */
  selectedLocationId: string;
  selectedLocation: Named | null;
  locations: Named[];
  loading: boolean;
  error: string;
  reload: () => void;
  selectLocation: (id: string) => void;
}

const StaffLocationContext = createContext<StaffLocationContextValue | null>(null);

export function StaffLocationProvider({ children }: { children: React.ReactNode }) {
  const { api, session } = useSession();
  const enabled =
    !!api && !!session && session.roles.includes('Staff') && !session.roles.includes('Owner');
  const [requestedLocationId, setRequestedLocationId] = useState('');
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    api: typeof api;
    revision: number;
    locations: Named[];
    error: string;
  } | null>(null);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  // This provider wraps the root navigator; use an AbortController instead of
  // navigation-aware hooks that require a mounted screen's navigation object.
  useEffect(() => {
    if (!enabled || !api) return;
    const controller = new AbortController();
    void api.request<Named[]>('/api/v1/capture/locations', { signal: controller.signal }).then(
      (rows) => {
        if (controller.signal.aborted) return;
        if (
          !Array.isArray(rows) ||
          rows.some(
            (item) =>
              !item ||
              typeof item.id !== 'string' ||
              !item.id.trim() ||
              typeof item.label !== 'string' ||
              !item.label.trim(),
          ) ||
          new Set(rows.map((item) => item.id)).size !== rows.length
        ) {
          setResult({ api, revision, locations: [], error: 'Phản hồi cơ sở không hợp lệ.' });
          return;
        }
        setResult({ api, revision, locations: rows, error: '' });
      },
      (failure) => {
        if (!controller.signal.aborted)
          setResult({ api, revision, locations: [], error: conciseMessage(errorMessage(failure)) });
      },
    );
    return () => controller.abort();
  }, [api, enabled, revision]);

  const assigned = enabled && result?.api === api && result.revision === revision ? result : null;
  const locations = assigned?.locations ?? [];
  // A fresh authorization result may remove a previous assignment. Never expose the
  // previous ID, even for one render, and never default to an unscoped Staff query.
  const selectedLocation =
    locations.find((item) => item.id === requestedLocationId) ?? locations[0] ?? null;
  const selectedLocationId = selectedLocation?.id ?? '';
  const selectLocation = (id: string) => {
    if (!enabled || !locations.some((item) => item.id === id)) return;
    setRequestedLocationId(id);
  };

  return (
    <StaffLocationContext.Provider
      value={{
        selectedLocationId,
        selectedLocation,
        locations,
        loading: enabled && !assigned,
        error: assigned?.error ?? '',
        reload,
        selectLocation,
      }}
    >
      {children}
    </StaffLocationContext.Provider>
  );
}

export function useStaffLocation(): StaffLocationContextValue {
  const context = useContext(StaffLocationContext);
  if (!context) throw new Error('StaffLocationProvider missing');
  return context;
}
