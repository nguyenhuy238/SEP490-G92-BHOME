import { useQueryClient } from '@tanstack/react-query';
import { usePortal } from '../../app/PortalProvider';
import type { PropertyCommand } from './model';
export function usePropertyMutation() {
  const { repository, notify } = usePortal(), client = useQueryClient();
  return async (command: PropertyCommand) => {
    await repository.executeProperty(command);
    await client.invalidateQueries({ queryKey: ['portal'] });
    notify('Đã cập nhật dữ liệu mô phỏng.');
  };
}
