import { useQuery } from '@tanstack/react-query';
import type { ContractClient } from '../../../../../packages/client-core/src/contracts';

export const inboxStages = [
  { value: 'Staff', label: 'Chờ nhân viên xử lý' },
  { value: 'Owner', label: 'Chờ chủ trọ xử lý' },
  { value: 'Tenant', label: 'Chờ khách thuê xử lý' },
  { value: 'Completed', label: 'Hoàn thành' },
] as const;

export function useInboxRooms(
  api: ContractClient,
  userId: string | undefined,
  location: string,
  inbox: 'handovers' | 'move-out-inbox',
) {
  return useQuery({
    queryKey: ['handover-inbox-rooms', userId, inbox, location],
    enabled: !!userId && !!location,
    queryFn: ({ signal }) =>
      api.transport<{ id: string; label: string }[]>(
        `/api/v1/contracts/${inbox}/rooms?${new URLSearchParams({ locationId: location })}`,
        { signal },
      ),
  });
}
