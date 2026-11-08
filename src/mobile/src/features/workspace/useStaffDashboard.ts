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
  roomNumber: string;
  locationName: string;
  scheduledAt: string;
  status: string;
}

export function useStaffDashboard() {
  const { role, preview } = useWorkspace();
  const enabled = role === 'Staff' && !preview;
  const today = businessToday();
  const locations = useWorkspaceQuery<Named[]>(enabled ? '/api/v1/capture/locations' : null, {
    cache: queryPolicies.rooms,
  });
  const tasks = useWorkspaceQuery<TaskPage<OperationalTask>>(
    enabled
      ? `/api/v1/operational-tasks?page=1&pageSize=1&dueFrom=${today}T00:00:00%2B07:00&dueTo=${today}T23:59:59.999%2B07:00`
      : null,
    { cache: queryPolicies.tasks },
  );
  const overdueAssigned = useWorkspaceQuery<TaskPage<OperationalTask>>(
    enabled ? '/api/v1/operational-tasks?page=1&pageSize=3&isOverdue=true&status=Assigned' : null,
    { cache: queryPolicies.tasks },
  );
  const overdueProgress = useWorkspaceQuery<TaskPage<OperationalTask>>(
    enabled ? '/api/v1/operational-tasks?page=1&pageSize=3&isOverdue=true&status=InProgress' : null,
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
    enabled ? '/api/v1/contracts/move-out-assignments' : null,
    { cache: queryPolicies.contracts },
  );
  const meters = useWorkspaceQuery<MeterTask[]>(
    enabled ? '/api/v1/capture/meter-tasks?page=1&status=0' : null,
    { cache: queryPolicies.meters },
  );
  const submittedIncidents = useWorkspaceQuery<IncidentPage<Incident>>(
    enabled ? `${incidentRoot}?status=Submitted&page=1&pageSize=1` : null,
    { cache: queryPolicies.incidents },
  );
  const processingIncidents = useWorkspaceQuery<IncidentPage<Incident>>(
    enabled ? `${incidentRoot}?status=InProgress&page=1&pageSize=1` : null,
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
  const reloadMeters = meters.reload;
  const reload = useCallback(() => {
    reloadLocations();
    reloadTasks();
    reloadOverdueAssigned();
    reloadOverdueProgress();
    reloadInspections();
    reloadMeters();
    reloadSubmittedIncidents();
    reloadProcessingIncidents();
  }, [
    reloadLocations,
    reloadTasks,
    reloadOverdueAssigned,
    reloadOverdueProgress,
    reloadInspections,
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
      meters,
      submittedIncidents,
      processingIncidents,
    ].some((query) => query.fetching),
  );
  return { locations, tasks, overdue, inspections, meters, incidents, reload };
}
