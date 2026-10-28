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
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: businessTimeZone,
  }).format(new Date(isoInstant));
