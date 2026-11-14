import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SetupFee } from '../../../../../../packages/client-core/src/locationSetup';
import { SetupBillingPreview } from './SetupBillingPreview';
import { calculateSetupPreview } from './setupBillingCalculation';

const roomType = { key: 'standard', name: 'Phòng 2 giường', capacity: 2, referenceRent: '2200000' };
const room = { key: 'r1', roomNumber: 'P.101', roomTypeKey: roomType.key, rent: null };
const otherRoom = { ...room, key: 'r2', roomNumber: 'P.102', rent: '2500000.125' };
const date = '2026-11-14';
const fee = (key: string, data: Partial<SetupFee> = {}): SetupFee & { key: string } => ({
  key,
  chargeCode: key.toUpperCase(),
  category: 3,
  method: 0,
  name: key,
  roomKey: null,
  rate: '10000',
  effectiveFrom: date,
  effectiveTo: null,
  ...data,
});
const fees = [
  fee('ELECTRICITY', { category: 1, method: 1, name: 'Điện', rate: '3500.125' }),
  fee('WATER', { category: 2, method: 1, name: 'Nước', rate: '20000' }),
  fee('WIFI', { name: 'Wifi', rate: '30000' }),
  fee('CLEANING', { name: 'Vệ sinh', method: 2, rate: '25000' }),
  fee('room-wifi', { chargeCode: 'WIFI', name: 'Wifi riêng', roomKey: 'r2', rate: '45000' }),
  fee('future', { effectiveFrom: '2026-12-01' }),
  fee('expired', { effectiveFrom: '2026-10-01', effectiveTo: '2026-11-13' }),
];
const base = { room, roomType, fees, rentDate: date, date, people: '2', kwh: '100', water: '10' };

afterEach(cleanup);

describe('setup billing simulation', () => {
  it('calculates full-month rent and fixed, metered and per-person charges with exact decimal arithmetic', () => {
    const result = calculateSetupPreview(base)!;
    expect(result.rows.map((row) => row.name)).toEqual([
      'Tiền thuê phòng',
      'Điện',
      'Nước',
      'Wifi',
      'Vệ sinh',
    ]);
    expect(result.total).toBe(28300125000n);
    expect(result.missingUtilities).toEqual([]);
  });

  it('uses a room-specific rate instead of its location-level fee and preserves the room rent override', () => {
    const result = calculateSetupPreview({ ...base, room: otherRoom })!;
    expect(result.rows.map((row) => row.name)).toContain('Wifi riêng');
    expect(result.rows.map((row) => row.name)).not.toContain('Wifi');
    expect(result.total).toBe(31450126250n);
  });

  it('does not guess a total for overlapping charges, missing room assignments or invalid input', () => {
    expect(
      calculateSetupPreview({ ...base, fees: [...fees, fee('duplicate', { chargeCode: 'WIFI' })] }),
    ).toBeNull();
    expect(
      calculateSetupPreview({ ...base, fees: [...fees, fee('pending', { roomKey: '' })] }),
    ).toBeNull();
    expect(calculateSetupPreview({ ...base, people: '3' })).toBeNull();
    expect(calculateSetupPreview({ ...base, kwh: '-1' })).toBeNull();
    expect(calculateSetupPreview({ ...base, date: '2026-11-13' })).toBeNull();
  });

  it('shows only configured charges and explicitly identifies missing utility prices', () => {
    render(
      <SetupBillingPreview
        rooms={[room, otherRoom]}
        roomTypes={[roomType]}
        fees={[fees[3]!]}
        rentDate={date}
      />,
    );
    const preview = within(
      screen.getByRole('region', { name: 'Mô phỏng chi phí hàng tháng của phòng' }),
    );
    expect(preview.getByText('2.225.000 đ')).toBeVisible();
    expect(preview.getByText(/Chưa có giá điện và nước hiệu lực/)).toBeVisible();
    fireEvent.change(preview.getByLabelText('Số người ở giả định'), { target: { value: '2' } });
    expect(preview.getByText('2.250.000 đ')).toBeVisible();
    fireEvent.mouseDown(preview.getByRole('combobox', { name: 'Phòng mô phỏng' }));
    fireEvent.click(screen.getByRole('option', { name: 'P.102 · Phòng 2 giường' }));
    expect(preview.getByText('2.525.000,125 đ')).toBeVisible();
  });
});
