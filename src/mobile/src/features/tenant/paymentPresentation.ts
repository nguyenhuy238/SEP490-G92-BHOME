import type { InvoicePayment } from '../../../../../packages/client-core/src/payments';
import { paymentText } from '../../../../../packages/client-core/src/payments';

// Display labels derive from verified decimal strings; never round through Number.
export function positiveAmount(value: string) {
  return /^\d+(?:\.\d+)?$/.test(value) && /[1-9]/.test(value);
}
export function tenantPaymentLabel(payment: InvoicePayment) {
  if (
    payment.paymentStatus === 'Unpaid' &&
    positiveAmount(payment.paidAmount) &&
    positiveAmount(payment.outstandingAmount)
  )
    return 'Đã thanh toán một phần';
  return paymentText(payment.paymentStatus);
}
export function sameAmount(left: string, right: string) {
  const canonical = (value: string) => {
    if (!/^\d+(?:\.\d+)?$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    return `${whole.replace(/^0+(?=\d)/, '')}.${fraction.replace(/0+$/, '')}`;
  };
  const amount = canonical(left);
  return amount !== null && amount === canonical(right);
}
