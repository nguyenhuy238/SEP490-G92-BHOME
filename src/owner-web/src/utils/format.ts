import dayjs from 'dayjs';
export const money = (value: number) =>
  new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);
export const compactMoney = (value: number) => `${(value / 1000000).toFixed(2)}M ₫`;
export const dateLabel = (value: string) =>
  dayjs(value).isValid() ? dayjs(value).format('DD/MM/YYYY') : value;
export function exportCsv(name: string, headers: string[], rows: string[][]) {
  const quote = (value: string) =>
    `"${(/^[=+\-@\t\r]/.test(value) ? "'" : '') + value.replaceAll('"', '""')}"`;
  const blob = new Blob(
    ['\uFEFF' + [headers, ...rows].map((row) => row.map(quote).join(',')).join('\r\n')],
    { type: 'text/csv;charset=utf-8' },
  );
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}-demo.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
