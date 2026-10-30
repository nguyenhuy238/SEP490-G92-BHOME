export const locale = 'vi-VN';
export const currency = 'VND';
export const businessTimeZone = 'Asia/Ho_Chi_Minh';
export const formatVnd = (value: number) =>
  new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
export const formatInstant = (isoInstant: string) =>
  new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: businessTimeZone,
  }).format(new Date(isoInstant));
