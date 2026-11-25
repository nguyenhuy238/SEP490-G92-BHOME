import { formatFinanceMoney } from '../../../../../packages/client-core/src/finance';

export function managementMoney(value: string | null | undefined) {
  return value == null ? 'Chưa xác định' : formatFinanceMoney(value);
}
