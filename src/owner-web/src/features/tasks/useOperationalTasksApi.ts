import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { ApiError } from '../../../../../packages/client-core/src/api';
import { useOwnerAction, type OwnerLocation } from '../../hooks/useOwnerWorkspace';
import { useMeterApi } from '../meters/useMeterApi';
import { readAllPages } from '../staff/useLocationAssignments';
import type { Staff } from '../staff/staffContracts';
import type { OwnerTask } from './taskContracts';

export const taskRoot = '/api/v1/operational-tasks';
export function useTaskDirectory() {
  const { request } = useMeterApi();
  const { session } = useAuth();
  const enabled = !!session?.roles.includes('Owner');
  const staff = useQuery({
    queryKey: ['owner-workspace', session?.userId, 'task-directory-staff'],
    enabled,
    staleTime: 60000,
    queryFn: ({ signal }) => readAllPages<Staff>(request, '/api/v1/staff', signal),
  });
  const locations = useQuery({
    queryKey: ['owner-workspace', session?.userId, 'task-directory-locations'],
    enabled,
    staleTime: 60000,
    queryFn: ({ signal }) => readAllPages<OwnerLocation>(request, '/api/v1/locations', signal),
  });
  return { staff, locations };
}
export function useTaskAction() {
  const action = useOwnerAction();
  const [conflict, setConflict] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const run = (work: () => Promise<unknown>) =>
    action.run(async () => {
      setFields({});
      try {
        return await work();
      } catch (error) {
        if (error instanceof ApiError) {
          setConflict(error.status === 409);
          setFields(
            Object.fromEntries(
              Object.entries(error.problem?.errors ?? {}).map(([key, messages]) => [
                key.split('.').pop()!.toLowerCase(),
                messages.join(' '),
              ]),
            ),
          );
        }
        throw error;
      }
    });
  return { ...action, run, conflict, fields, reviewed: () => setConflict(false) };
}
export const responsibleName = (task: OwnerTask, staff: Staff[]) =>
  !task.responsibilityAvailable
    ? 'Chưa có người phụ trách'
    : staff.find((item) => item.userId === task.currentResponsibleStaffUserId)?.fullName?.trim() ||
      'Không tải được tên nhân viên';
export function taskActions(task: OwnerTask) {
  if (task.kind !== 'AdHoc') return [];
  if (task.status === 'PendingVerification') return ['verify', 'rework'];
  if (['Assigned', 'InProgress'].includes(task.status))
    return ['edit', 'coordinate', ...(task.responsibilityAvailable ? ['assign'] : []), 'cancel'];
  return [];
}
export const actionNames: Record<string, string> = {
  edit: 'Chỉnh sửa',
  coordinate: 'Ghi chú phối hợp',
  assign: 'Đồng bộ người phụ trách',
  cancel: 'Hủy công việc',
  verify: 'Nghiệm thu',
  rework: 'Yêu cầu làm lại',
};
