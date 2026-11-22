// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  ContractClient,
  FinalInspection,
} from '../../../../packages/client-core/src/contracts';

vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Modal: ({ children, visible }: { children: React.ReactNode; visible: boolean }) =>
    visible ? <div role="dialog">{children}</div> : null,
  StyleSheet: { create: <T,>(styles: T) => styles, hairlineWidth: 1 },
  useWindowDimensions: () => ({ width: 320, height: 741 }),
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Icon: () => null,
  Button: ({
    children,
    onPress,
    disabled,
    accessibilityLabel,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
    accessibilityLabel?: string;
  }) => (
    <button disabled={disabled} aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
  TouchableRipple: ({
    children,
    accessibilityLabel,
    onPress,
  }: {
    children: React.ReactNode;
    accessibilityLabel?: string;
    onPress: () => void;
  }) => (
    <button aria-label={accessibilityLabel} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock('../theme/theme', () => ({
  colors: {
    navy: '#001637',
    blue: '#1052cf',
    muted: '#64748b',
    border: '#e2e8f0',
    green: '#168565',
    amber: '#a86108',
  },
}));
vi.mock('../components/WorkspaceKit', () => ({
  Pill: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('../features/contracts/ContractEvidence', () => ({
  ContractEvidence: ({ label, evidenceId }: { label?: string; evidenceId?: string }) => (
    <span>
      {label}
      {evidenceId ? ` · ${evidenceId}` : ''}
    </span>
  ),
}));

import { TenantMoveOutInspectionSummary } from '../features/contracts/TenantMoveOutInspectionSummary';

afterEach(cleanup);

it('shows the four MoveIn-style result rows with whole-number final meters and nested room details', () => {
  const inspection = {
    id: 'inspection-1',
    version: 2,
    inspectedAt: '2026-11-22T10:00:00Z',
    baseline: {
      roomChecks: [
        { code: 'walls_ceiling_floor', status: 'Passed', notes: 'Tốt', evidenceIds: [] },
      ],
      assets: [{ id: 'bed', name: 'Giường', handedOverQuantity: 1 }],
      accessItems: [{ type: 'RoomKey', quantity: 6 }],
    },
    observed: {
      electricity: { id: 'final-electricity', value: '100.0000' },
      water: { id: 'final-water', value: '200.0000' },
      roomChecks: [
        { code: 'walls_ceiling_floor', status: 'Issue', notes: 'Bị tróc sơn', evidenceIds: [] },
      ],
      assets: [
        {
          id: 'bed',
          name: 'Giường',
          observedQuantity: 1,
          observedCondition: 'Tốt',
          evidenceIds: [],
        },
      ],
      physicalItemEvidence: [
        {
          assetId: 'bed',
          physicalAssetId: 'bed-physical-1',
          notes: 'Trầy cạnh giường',
          evidenceIds: ['private-move-out-asset-photo'],
        },
      ],
      accessItems: [{ type: 'RoomKey', quantity: 5 }],
      keyEvidenceIds: [],
      evidenceIds: [],
    },
  } as unknown as FinalInspection;
  render(
    <TenantMoveOutInspectionSummary
      api={{} as ContractClient}
      contractId="contract-1"
      inspection={inspection}
    />,
  );

  expect(screen.getByText('Nội dung trả phòng')).toBeTruthy();
  expect(screen.getByText(/Điện: 100 kWh · Nước: 200 m³/)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Tài sản' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Chìa khóa' })).toBeTruthy();
  expect(screen.getByText('5 chiếc đã nhận lại')).toBeTruthy();
  expect(screen.queryByText(/private-move-out-asset-photo/)).toBeNull();
  expect(screen.queryByText(/biên bản/i)).toBeNull();
  expect(screen.queryByText(/final-electricity/)).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Hiện trạng phòng' }));
  expect(screen.getByRole('dialog')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Tường, trần và sàn/ }));
  expect(screen.getByText('Nội dung: Bị tróc sơn')).toBeTruthy();
  expect(screen.queryByText('Lúc bàn giao')).toBeNull();
  expect(screen.queryByText('Lúc trả phòng')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));
  expect(screen.queryByRole('dialog')).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: 'Tài sản' }));
  fireEvent.click(screen.getByRole('button', { name: 'Giường' }));
  expect(screen.getByText('Số lượng hiện tại')).toBeTruthy();
  expect(screen.getByText('Trầy cạnh giường')).toBeTruthy();
  expect(screen.getByText(/private-move-out-asset-photo/)).toBeTruthy();
  expect(screen.queryByText('Số lượng lúc bàn giao')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng' }));

  fireEvent.click(screen.getByRole('button', { name: 'Chìa khóa' }));
  expect(screen.getByText('Số chìa khóa hiện tại: 5')).toBeTruthy();
  expect(screen.queryByText(/Số chìa khóa lúc bàn giao/)).toBeNull();
});
