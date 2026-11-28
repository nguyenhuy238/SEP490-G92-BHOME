import type { CommonAssetInventoryItem } from '../../../../../packages/client-core/src/propertySetup';

type UnitCostItem = Pick<CommonAssetInventoryItem, 'acquisitionUnitCost' | 'referenceUnitCost'>;

export const defaultUnitCost = (item: UnitCostItem): string => {
  const value = item.acquisitionUnitCost ?? item.referenceUnitCost;
  const raw = value == null ? '' : String(value);
  return /^\d{1,14}$/.test(raw) ? raw : '';
};
export const validUnitCost = (value: string): boolean =>
  value === '' || (/^\d{1,14}$/.test(value) && Number(value) <= 99_999_999_999_999);
export const unitCostHint = (item: UnitCostItem): string =>
  item.acquisitionUnitCost != null
    ? 'Đã chốt giá vốn'
    : item.referenceUnitCost != null && defaultUnitCost(item) === ''
      ? 'Giá mẫu không phải số nguyên VND; vui lòng nhập đơn giá mua.'
      : item.referenceUnitCost != null
        ? 'Gợi ý từ mẫu'
        : 'Chưa có giá tham khảo';
