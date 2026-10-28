import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePortal } from '../app/PortalProvider';
export function usePortalData() {
  const { repository } = usePortal();
  return useQuery({ queryKey: ['portal'], queryFn: ({ signal }) => repository.read(signal) });
}
export function usePortalAction() {
  const queryClient = useQueryClient();
  const { notify } = usePortal();
  return useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['portal'] });
      notify('Đã lưu thay đổi vào dữ liệu demo.');
    },
    onError: (error) =>
      notify(
        error instanceof Error ? error.message : 'Không thể lưu dữ liệu. Vui lòng thử lại.',
        true,
      ),
  });
}
