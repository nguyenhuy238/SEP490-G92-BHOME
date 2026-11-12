import { staffColors as s, colors as c } from '../../theme/theme';

// BHome.Domain.TenantContracts: Pending=0, Verified=1, Rejected=2.
export function residentStatus(status: number) {
  switch (status) {
    case 0:
      return {
        label: 'Chờ xác minh',
        icon: 'clock-outline',
        color: s.orange,
        background: s.orangeSoft,
      };
    case 1:
      return {
        label: 'Đã xác minh',
        icon: 'shield-check-outline',
        color: s.green,
        background: s.greenSoft,
      };
    case 2:
      return {
        label: 'Đã từ chối',
        icon: 'alert-circle-outline',
        color: s.red,
        background: s.redSoft,
      };
    default:
      return {
        label: 'Chưa rõ trạng thái',
        icon: 'help-circle-outline',
        color: c.muted,
        background: c.soft,
      };
  }
}

export function residentRole(type?: number) {
  return type === 0 ? 'Người đại diện' : type === 1 ? 'Người ở cùng' : 'Chưa có vai trò';
}
