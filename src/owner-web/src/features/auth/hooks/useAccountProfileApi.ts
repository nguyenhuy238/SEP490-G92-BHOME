import { useMemo } from 'react';
import { useMeterApi } from '../../meters/useMeterApi';

export interface AccountProfile {
  userId: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  roles: string[];
  isActive: boolean;
  version: string;
}

export interface AccountProfileUpdate {
  fullName: string;
  phone: string | null;
  email: string;
  version: string;
}

export function useAccountProfileApi() {
  const { request } = useMeterApi();
  return useMemo(
    () => ({
      get: (signal?: AbortSignal) =>
        request<AccountProfile>('/api/v1/account/profile', { signal }),
      update: (input: AccountProfileUpdate) =>
        request<AccountProfile>('/api/v1/account/profile', {
          method: 'PUT',
          body: JSON.stringify(input),
        }),
    }),
    [request],
  );
}
