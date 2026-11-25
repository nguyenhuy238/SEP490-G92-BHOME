// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { HandoverAsset } from '../../../../packages/client-core/src/contracts';

vi.mock('react-native', () => ({
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('../theme/theme', () => ({ colors: { red: '#b91c1c' } }));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  SegmentedButtons: ({
    value,
    onValueChange,
    buttons,
  }: {
    value: string;
    onValueChange: (next: string) => void;
    buttons: { value: string; label: string; disabled?: boolean }[];
  }) => (
    <div>
      {buttons.map((button) => (
        <button
          key={button.value}
          aria-pressed={value === button.value}
          disabled={button.disabled}
          onClick={() => onValueChange(button.value)}
        >
          {button.label}
        </button>
      ))}
    </div>
  ),
  Checkbox: {
    Item: ({
      label,
      status,
      onPress,
      disabled,
    }: {
      label: string;
      status: string;
      onPress: () => void;
      disabled?: boolean;
    }) => (
      <button aria-pressed={status === 'checked'} onClick={onPress} disabled={disabled}>
        {label}
      </button>
    ),
  },
}));
vi.mock('../components/WorkflowControls', () => ({
  Input: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (next: string) => void;
  }) => (
    <label>
      {label}
      <input aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  ),
}));
vi.mock('../components/WorkspaceKit', () => ({
  Action: ({
    children,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));

import { HandoverAssetFields } from '../features/contracts/HandoverAssetFields';

const asset = {
  id: 'asset-1',
  name: 'Quạt',
  unit: 'cái',
  configuredQuantity: 2,
  handedOverQuantity: 2,
  inventoryCondition: 'Tốt',
  checked: false,
} as HandoverAsset;

function InspectionHarness() {
  const [visible, setVisible] = React.useState(true);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const set = (key: string, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  return (
    <>
      <button onClick={() => setVisible((current) => !current)}>Chuyển bước</button>
      {visible && (
        <HandoverAssetFields asset={asset} values={values} set={set} evidenceIds={[]} compact />
      )}
      <output data-testid="inspection-values">{JSON.stringify(values)}</output>
    </>
  );
}

function inspectionValues(): Record<string, string> {
  return JSON.parse(screen.getByTestId('inspection-values').textContent ?? '{}') as Record<
    string,
    string
  >;
}

afterEach(cleanup);

it('clears autofilled exact counts and the checked flag when Staff switches to a discrepancy', () => {
  render(<InspectionHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra Quạt' }));
  fireEvent.click(screen.getByRole('button', { name: 'Đúng số lượng' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tốt' }));
  fireEvent.click(screen.getByRole('button', { name: 'Đã kiểm tra Quạt' }));
  expect(inspectionValues()['asset-1.observedQuantity']).toBe('2');
  expect(inspectionValues()['asset-1.checked']).toBe('true');

  fireEvent.click(screen.getByRole('button', { name: 'Có chênh lệch' }));
  const values = inspectionValues();
  expect(values['asset-1.quantityMode']).toBe('difference');
  expect(values['asset-1.checked']).toBe('false');
  for (const key of [
    'observedQuantity',
    'handedOverQuantity',
    'goodQuantity',
    'wornQuantity',
    'damagedQuantity',
  ]) {
    expect(values[`asset-1.${key}`]).toBe('');
  }
  expect(
    (screen.getByRole('button', { name: 'Có chênh lệch' }) as HTMLButtonElement).getAttribute(
      'aria-pressed',
    ),
  ).toBe('true');
  expect((screen.getByLabelText('Quạt · Số lượng thực tế') as HTMLInputElement).value).toBe('');
});

it('retains the selected discrepancy mode and entered counts when Wizard unmounts and returns to the asset step', () => {
  render(<InspectionHarness />);
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra Quạt' }));
  fireEvent.click(screen.getByRole('button', { name: 'Có chênh lệch' }));
  fireEvent.change(screen.getByLabelText('Quạt · Số lượng thực tế'), { target: { value: '1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Chuyển bước' }));
  expect(screen.queryByRole('button', { name: 'Có chênh lệch' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Chuyển bước' }));
  fireEvent.click(screen.getByRole('button', { name: 'Kiểm tra Quạt' }));
  expect(
    (screen.getByRole('button', { name: 'Có chênh lệch' }) as HTMLButtonElement).getAttribute(
      'aria-pressed',
    ),
  ).toBe('true');
  expect((screen.getByLabelText('Quạt · Số lượng thực tế') as HTMLInputElement).value).toBe('1');
});
