import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { invoiceError } from '../../../../../packages/client-core/src/invoices';

export function useSetupAction() {
  const cache = useQueryClient();
  const lock = useRef(false);
  const [notice, setNotice] = useState('');
  const mutation = useMutation({
    mutationFn: async ({
      action,
      message,
    }: {
      action: () => Promise<unknown>;
      message: string;
    }) => {
      await action();
      return message;
    },
    onSuccess: async (message) => {
      await cache.invalidateQueries({ queryKey: ['property-setup'] });
      setNotice(message);
    },
  });
  return {
    busy: mutation.isPending,
    error: mutation.error ? invoiceError(mutation.error) : '',
    notice,
    run: (action: () => Promise<unknown>, message = 'Máy chủ đã xử lý yêu cầu.') => {
      if (lock.current) return;
      lock.current = true;
      setNotice('');
      void mutation
        .mutateAsync({ action, message })
        .catch(() => {})
        .finally(() => {
          lock.current = false;
        });
    },
  };
}
