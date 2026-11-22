import { UserFeedbackError } from './api';
import type { HandoverAsset } from './contracts';

export const quantityFields = [
  ['observedQuantity', 'Số lượng thực tế'],
  ['handedOverQuantity', 'Số lượng bàn giao'],
  ['goodQuantity', 'Tình trạng tốt'],
  ['wornQuantity', 'Hao mòn'],
  ['damagedQuantity', 'Hư hỏng'],
] as const;
export function handoverQuantity(value: string, label: string): number {
  if (!/^\d+$/.test(value) || Number(value) > 10000)
    throw new UserFeedbackError(`${label}: nhập số nguyên từ 0 đến 10.000.`);
  return Number(value);
}
export function assetInspectionInput(
  a: HandoverAsset,
  values: Record<string, string>,
  evidenceIds: string[],
  quantities: boolean,
  known = true,
) {
  const condition = values[`asset-${a.id}`]?.trim() ?? '';
  if (!condition) throw new UserFeedbackError(`Nhập tình trạng ${a.name}.`);
  if (!quantities) return { id: a.id, condition };
  const quantitiesValue = Object.fromEntries(
    quantityFields.map(([key, label]) => [
      key,
      handoverQuantity(values[`${a.id}.${key}`] ?? '', `${a.name} · ${label}`),
    ]),
  ) as Record<(typeof quantityFields)[number][0], number>;
  const expected =
    a.configuredQuantity ??
    a.handedOverQuantity ??
    a.physicalAssets?.reduce((sum, p) => sum + p.quantity, 0) ??
    0;
  const physicalObservations =
    (a.physicalAssets?.length ?? 0) > 1
      ? a.physicalAssets!.map((p) => ({
          id: p.id,
          quantity: handoverQuantity(
            values[`${p.id}.physicalQuantity`] ?? '',
            `${a.name} · tài sản ${p.id}`,
          ),
          condition: values[`${p.id}.physicalCondition`]?.trim() || condition,
          handedOverQuantity: values[`${p.id}.physicalHandedOverQuantity`]
            ? handoverQuantity(
                values[`${p.id}.physicalHandedOverQuantity`],
                `${a.name} · số lượng giao từng tài sản`,
              )
            : undefined,
        }))
      : undefined;
  return {
    id: a.id,
    condition,
    ...quantitiesValue,
    missingQuantity: known ? Math.max(0, expected - quantitiesValue.observedQuantity) : 0,
    checked: values[`${a.id}.checked`] === 'true',
    notes: values[`${a.id}.notes`] ?? '',
    evidenceIds: evidenceIds.filter((id) => values[`${a.id}.evidence.${id}`] === 'true'),
    physicalObservations,
  };
}
export function handoverAssetSummary(a: HandoverAsset): string {
  if (a.observedQuantity == null)
    return `${a.name}: ${a.observedCondition} · Dữ liệu cũ chưa có số lượng`;
  return `${a.name} (${a.unit ?? 'đơn vị'}): thực tế ${a.observedQuantity}, bàn giao ${a.handedOverQuantity ?? 'chưa rõ'}; tốt ${a.goodQuantity ?? '?'}, hao mòn ${a.wornQuantity ?? '?'}, hỏng ${a.damagedQuantity ?? '?'}, thiếu ${a.missingQuantity ?? '?'}. ${a.observedCondition}`;
}
