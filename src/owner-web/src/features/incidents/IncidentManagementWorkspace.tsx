import { useEffect, useRef, useState } from 'react';
import { Box } from '@mui/material';
import { useSearchParams } from 'react-router';
import { IncidentQueueWorkspace, type IncidentQueueFilters } from './IncidentQueueWorkspace';
import { IncidentDetailWorkspace } from './IncidentDetailWorkspace';
import { WorkOrderDetailWorkspace } from './WorkOrderDetailWorkspace';

/**
 * Deep-link-safe navigation. The queue and one selected record never render
 * simultaneously: opening a record must not push its actions below a long table.
 */
export function IncidentManagementWorkspace({ maintenance = false }: { maintenance?: boolean }) {
  const [params, setParams] = useSearchParams();
  const selectedKey = maintenance ? 'workOrderId' : 'incidentId';
  const selected = params.get(selectedKey) ?? '';
  const rootRef = useRef<HTMLDivElement>(null);
  // The queue unmounts while a detail is open. Preserve its navigation context
  // so returning to the queue does not unexpectedly reset filters or paging.
  const [queueFilters, setQueueFilters] = useState<IncidentQueueFilters>(() => ({
    location: params.get('locationId') ?? '',
    room: '',
    status: '',
    severity: '',
    page: 1,
    search: '',
  }));

  useEffect(() => {
    if (selected) rootRef.current?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
  }, [selected]);

  const updateParam = (key: string, value: string) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  };

  return (
    <Box ref={rootRef} sx={{ minWidth: 0 }}>
      {selected ? (
        maintenance ? (
          <WorkOrderDetailWorkspace
            key={selected}
            id={selected}
            showIncident
            onBack={() => updateParam('workOrderId', '')}
          />
        ) : (
          <IncidentDetailWorkspace
            key={selected}
            id={selected}
            onBack={() => updateParam('incidentId', '')}
          />
        )
      ) : (
        <IncidentQueueWorkspace
          maintenance={maintenance}
          initialLocation={params.get('locationId') ?? ''}
          initialFilters={queueFilters}
          onFiltersChange={setQueueFilters}
          incidentFilter={maintenance ? (params.get('incidentId') ?? '') : ''}
          onSelect={(id) => updateParam(selectedKey, id)}
          onClearIncidentFilter={() => updateParam('incidentId', '')}
        />
      )}
    </Box>
  );
}
