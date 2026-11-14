import { formatBillingDecimal } from '../../../../../../packages/client-core/src/invoices';
import type { SetupFee } from '../../../../../../packages/client-core/src/locationSetup';

export type PreviewRoom = {
  key: string;
  roomNumber: string;
  roomTypeKey: string;
  rent: number | string | null;
};
export type PreviewType = {
  key: string;
  name: string;
  capacity: number;
  referenceRent: number | string | null;
};
export type PreviewFee = SetupFee & { key: string };
const SCALE = 10000n;

// Match the setup API's four-decimal rate precision without floating-point drift.
function scaledRate(value: string | number | null): bigint | null {
  if (value === null || !/^\d{1,14}(?:\.\d{1,4})?$/.test(String(value))) return null;
  const [whole, fraction = ''] = String(value).split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(4, '0'));
}
export const amountLabel = (value: bigint) =>
  `${formatBillingDecimal(`${value / SCALE}.${String(value % SCALE).padStart(4, '0')}`)} đ`;
const usage = (value: string) => (/^\d{1,6}$/.test(value) ? BigInt(value) : null);

export function calculateSetupPreview({
  room,
  roomType,
  fees,
  rentDate,
  date,
  people,
  kwh,
  water,
}: {
  room?: PreviewRoom;
  roomType?: PreviewType;
  fees: PreviewFee[];
  rentDate: string;
  date: string;
  people: string;
  kwh: string;
  water: string;
}) {
  const rent = scaledRate(room?.rent ?? roomType?.referenceRent ?? null);
  const occupants = usage(people),
    electricity = usage(kwh),
    m3 = usage(water);
  if (
    !room ||
    !roomType ||
    !Number.isSafeInteger(roomType.capacity) ||
    roomType.capacity < 1 ||
    rent === null ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(rentDate) ||
    date < rentDate ||
    occupants === null ||
    occupants < 1n ||
    occupants > BigInt(roomType.capacity) ||
    electricity === null ||
    m3 === null
  )
    return null;
  if (fees.some((fee) => fee.roomKey === '')) return null;
  // A room-scoped charge overrides a location charge with the same code, as in the property API.
  const applicable = fees.filter(
    (fee) =>
      fee.category !== 0 &&
      (fee.roomKey === null || fee.roomKey === room.key) &&
      fee.effectiveFrom <= date &&
      (!fee.effectiveTo || fee.effectiveTo >= date),
  );
  const codes = new Set(applicable.map((fee) => fee.chargeCode.trim().toUpperCase()));
  const rows: { key: string; name: string; detail: string; amount: bigint }[] = [
    { key: 'rent', name: 'Tiền thuê phòng', detail: room.roomNumber, amount: rent },
  ];
  for (const code of codes) {
    const matching = applicable.filter((fee) => fee.chargeCode.trim().toUpperCase() === code);
    const specific = matching.filter((fee) => fee.roomKey === room.key);
    const selected = specific.length ? specific : matching;
    if (selected.length !== 1 || !code) return null;
    const fee = selected[0];
    const rate = scaledRate(fee.rate);
    if (rate === null || !fee.name.trim()) return null;
    const quantity =
      fee.method === 2
        ? occupants
        : fee.method === 1
          ? fee.category === 2
            ? m3
            : electricity
          : 1n;
    const unit =
      fee.method === 2 ? 'người' : fee.method === 1 ? (fee.category === 2 ? 'm³' : 'kWh') : 'phòng';
    rows.push({
      key: fee.key,
      name: fee.name,
      detail: `${quantity} ${unit} × ${amountLabel(rate)}`,
      amount: rate * quantity,
    });
  }
  return {
    rows,
    total: rows.reduce((sum, row) => sum + row.amount, 0n),
    missingUtilities: [1, 2].filter(
      (category) => !applicable.some((fee) => fee.category === category),
    ),
  };
}
