import { incidentRoot, type IncidentPage, type Incident } from '../../services/incidents';
import { useCallback } from 'react';
import { queryPolicies } from '../../lib/queryPolicies';
import { useWorkspaceHeaderRefresh } from '../../components/WorkspaceHeaderContext';
import { businessToday } from '../../../../../packages/client-core/src/contracts';
import type { MeterTask, Named } from '../../lib/api';
import type { OperationalTask, TaskPage } from '../../services/operationalTasks';
import { useWorkspace } from './WorkspaceProvider';
import { useWorkspaceQuery } from './useWorkspaceQuery';

export interface MoveOutAssignment {
  contractId: string;
  roomId: string;
  roomNumber: string;
  locationName: string;
  proposedDate?: string;
  scheduledAt: string | null;
  status: string;
}

export function useStaffDashboard() {
  const { role, preview, staffLocationId } = useWorkspace();
  const enabled = role === 'Staff' && !preview;
  const scoped = enabled && !!staffLocationId;
  const locationQuery = `locationId=${encodeURIComponent(staffLocationId)}`;
  const today = businessToday();
  const locations = useWorkspaceQuery<Named[]>(enabled ? '/api/v1/capture/locations' : null, {
    cache: queryPolicies.rooms,
  });
  const tasks = useWorkspaceQuery<TaskPage<OperationalTask>>(
    scoped
      ? `/api/v1/operational-tasks?page=1&pageSize=1&${locationQuery}&category=Operational&dueFrom=${today}T00:00:00%2B07:00&dueTo=${today}T23:59:59.999%2B07:00`
      : null,
    { cache: queryPolicies.tasks },
  );
  const overdueAssigned = useWorkspaceQuery<TaskPage<OperationalTask>>(
    scoped
      ? `/api/v1/operational-tasks?page=1&pageSize=3&${locationQuery}&isOverdue=true&status=Assigned`
      : null,
    { cache: queryPolicies.tasks },
  );
  const overdueProgress = useWorkspaceQuery<TaskPage<OperationalTask>>(
    scoped
      ? `/api/v1/operational-tasks?page=1&pageSize=3&${locationQuery}&isOverdue=true&status=InProgress`
      : null,
    { cache: queryPolicies.tasks },
  );
  // PendingVerification needs Owner action. Query the two actionable states separately
  // so its earlier rows cannot hide Staff tasks behind the first server page.
  const overdue = {
    data:
      overdueAssigned.data || overdueProgress.data
        ? {
            items: [...(overdueAssigned.data?.items ?? []), ...(overdueProgress.data?.items ?? [])]
              .sort(
                (a, b) =>
                  (a.dueAt ? Date.parse(a.dueAt) : Infinity) -
                    (b.dueAt ? Date.parse(b.dueAt) : Infinity) || a.id.localeCompare(b.id),
              )
              .slice(0, 3),
          }
        : null,
    error: overdueAssigned.error || overdueProgress.error,
    loading: overdueAssigned.loading || overdueProgress.loading,
  };
  const inspections = useWorkspaceQuery<MoveOutAssignment[]>(
    scoped ? '/api/v1/contracts/move-out-assignments' : null,
    { cache: queryPolicies.contracts },
  );
  const rooms = useWorkspaceQuery<Named[]>(
    scoped ? `/api/v1/capture/locations/${encodeURIComponent(staffLocationId)}/rooms` : null,
    { cache: queryPolicies.rooms },
  );
  const authorizedRoomIds = new Set((rooms.data ?? []).map((room) => room.id));
  // The move-out assignment DTO has RoomId but not LocationId, and its endpoint is
  // account-wide. Join it against rooms fetched for this selected authorized Location.
  // Never use potentially duplicated LocationName labels as a security/scope key.
  const scopedInspections = {
    ...inspections,
    data:
      scoped && rooms.data && inspections.data
        ? inspections.data.filter((entry) => authorizedRoomIds.has(entry.roomId))
        : null,
    error: inspections.error || rooms.error,
    loading: inspections.loading || rooms.loading,
    fetching: inspections.fetching || rooms.fetching,
  };
  const meters = useWorkspaceQuery<MeterTask[]>(
    scoped ? `/api/v1/capture/meter-tasks?page=1&status=0&${locationQuery}` : null,
    { cache: queryPolicies.meters },
  );
  const submittedIncidents = useWorkspaceQuery<IncidentPage<Incident>>(
    scoped ? `${incidentRoot}?status=Submitted&page=1&pageSize=1&${locationQuery}` : null,
    { cache: queryPolicies.incidents },
  );
  const processingIncidents = useWorkspaceQuery<IncidentPage<Incident>>(
    scoped ? `${incidentRoot}?status=InProgress&page=1&pageSize=1&${locationQuery}` : null,
    { cache: queryPolicies.incidents },
  );
  const incidents = {
    total:
      typeof submittedIncidents.data?.totalCount === 'number' &&
      typeof processingIncidents.data?.totalCount === 'number'
        ? submittedIncidents.data.totalCount + processingIncidents.data.totalCount
        : null,
    error: submittedIncidents.error || processingIncidents.error,
  };
  const reloadSubmittedIncidents = submittedIncidents.reload;
  const reloadProcessingIncidents = processingIncidents.reload;
  const reloadLocations = locations.reload;
  const reloadTasks = tasks.reload;
  const reloadOverdueAssigned = overdueAssigned.reload;
  const reloadOverdueProgress = overdueProgress.reload;
  const reloadInspections = inspections.reload;
  const reloadRooms = rooms.reload;
  const reloadMeters = meters.reload;
  const reload = useCallback(() => {
    reloadLocations();
    reloadTasks();
    reloadOverdueAssigned();
    reloadOverdueProgress();
    reloadInspections();
    reloadRooms();
    reloadMeters();
    reloadSubmittedIncidents();
    reloadProcessingIncidents();
  }, [
    reloadLocations,
    reloadTasks,
    reloadOverdueAssigned,
    reloadOverdueProgress,
    reloadInspections,
    reloadRooms,
    reloadMeters,
    reloadSubmittedIncidents,
    reloadProcessingIncidents,
  ]);
  useWorkspaceHeaderRefresh(
    reload,
    [
      locations,
      tasks,
      overdueAssigned,
      overdueProgress,
      inspections,
      rooms,
      meters,
      submittedIncidents,
      processingIncidents,
    ].some((query) => query.fetching),
  );
  return { locations, tasks, overdue, inspections: scopedInspections, meters, incidents, reload };
}
