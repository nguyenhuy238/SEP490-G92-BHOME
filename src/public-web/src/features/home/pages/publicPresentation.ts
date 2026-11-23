export const vacancyLabel = (value: string) =>
  ({
    Available: 'Còn trống',
    OnHold: 'Đang giữ chỗ',
    Occupied: 'Đã có người ở',
    Unavailable: 'Tạm ngừng cho thuê',
  })[value] ?? 'Chưa công bố tình trạng';

export function paginationLabel(type: string, page: number | null, selected: boolean) {
  if (type === 'page') return selected ? `Trang ${page} hiện tại` : `Đến trang ${page}`;
  return (
    { first: 'Trang đầu', last: 'Trang cuối', previous: 'Trang trước', next: 'Trang tiếp' }[type] ??
    'Các trang khác'
  );
}
