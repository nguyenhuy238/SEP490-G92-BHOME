export const validCount = (value: number | undefined): value is number =>
  value != null && Number.isSafeInteger(value) && value >= 0;
export const formatRoomCount = (value?: number) =>
  validCount(value) ? value.toLocaleString('vi-VN') : '—';
