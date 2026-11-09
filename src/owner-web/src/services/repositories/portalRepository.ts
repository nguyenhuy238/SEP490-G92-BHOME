import type { PortalRepository } from '../../types/portal';
import { createMockRepository } from './mockPortalRepository';

export function createPortalRepository(mock: boolean): PortalRepository {
  if (mock) return createMockRepository();
  const unsupported = async (): Promise<never> => {
    throw new Error(
      'Thao tác này chưa kết nối API. Dữ liệu demo không được sử dụng trong chế độ API.',
    );
  };
  return {
    executeProperty: unsupported,
    read: unsupported,
    save: unsupported,
    remove: unsupported,
    transition: unsupported,
    reconcile: unsupported,
    saveScenario: unsupported,
    markAllRead: unsupported,
    recordDebtFollowup: unsupported,
    reset: unsupported,
  };
}
