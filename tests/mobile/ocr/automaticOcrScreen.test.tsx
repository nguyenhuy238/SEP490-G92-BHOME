// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AutomaticAnalysis } from '../../../src/mobile/src/lib/automaticOcr';
import { MobileApiError } from '../../../src/mobile/src/lib/api';
const mocks = vi.hoisted(() => ({
  image: vi.fn(),
  request: vi.fn(),
  onState: null as ((s: string) => void) | null,
  role: 'Staff',
  captured: new Uint8Array([1, 2, 3]),
  protect: vi.fn(),
}));
type Children = { children?: React.ReactNode };
vi.mock('expo-router', () => ({ Redirect: () => <span>Đăng nhập</span> }));
vi.mock('expo-screen-capture', () => ({
  usePreventScreenCapture: mocks.protect,
  enableAppSwitcherProtectionAsync: async () => {},
  disableAppSwitcherProtectionAsync: async () => {},
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  View: ({ children }: Children) => <div>{children}</div>,
  Image: ({
    accessibilityLabel,
    source,
  }: {
    accessibilityLabel: string;
    source: { uri: string };
  }) => <img alt={accessibilityLabel} src={source.uri} />,
  AppState: {
    addEventListener: (_event: string, callback: (s: string) => void) => {
      mocks.onState = callback;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: Children) => <span>{children}</span>,
  ActivityIndicator: () => <span>Đang kiểm tra</span>,
  Button: ({
    children,
    disabled,
    onPress,
  }: Children & { disabled?: boolean; onPress: () => void }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
}));
vi.mock('../../../src/mobile/src/components/Controls', () => ({
  styles: {},
  Page: ({ children }: Children) => <main>{children}</main>,
  Field: ({
    label,
    value,
    onChange,
  }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <label>
      {label}
      <input value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  ),
  Select: ({
    label,
    items,
    selected,
    onSelect,
  }: {
    label: string;
    items: { id: string; label: string }[];
    selected: string;
    onSelect: (v: string) => void;
  }) => (
    <label>
      {label}
      <select value={selected} onChange={(e) => onSelect(e.target.value)}>
        <option value="" />
        {items.map((i) => (
          <option key={i.id} value={i.id}>
            {i.label}
          </option>
        ))}
      </select>
    </label>
  ),
}));
vi.mock('../../../src/mobile/src/components/CameraCapture', () => ({
  CameraCapture: ({
    label,
    buttonMode,
    disabled,
    onCapture,
  }: {
    label: string;
    buttonMode: string;
    disabled: boolean;
    onCapture: (b: Uint8Array<ArrayBuffer>) => Promise<void>;
  }) => (
    <button
      data-mode={buttonMode}
      disabled={disabled}
      onClick={() => void onCapture(mocks.captured.slice())}
    >
      {label}
    </button>
  ),
}));
vi.mock('../../../src/mobile/src/lib/SessionProvider', () => ({
  useSession: () => ({ api: mocks, session: { roles: [mocks.role] } }),
}));
import OcrTest from '../../../src/mobile/src/app/ocr-test';
const proposal = (fields: Record<string, string>) => ({
  proposedFields: fields,
  missingFields: [],
  confidence: {},
  warnings: [],
  isFallback: false,
  requiresConfirmation: true,
});
const unknown = (
  status: AutomaticAnalysis['classificationStatus'] = 'ambiguous',
): AutomaticAnalysis => ({
  classificationStatus: status,
  detectedCategory: 'unknown',
  classificationConfidence: null,
  classificationSource: 'text_rules',
  candidateCategories: [],
  warnings: [],
  identityProposal: null,
  meterProposal: null,
});
const front = (): AutomaticAnalysis => ({
  ...unknown('classified'),
  detectedCategory: 'cccd_front',
  identityProposal: proposal({ fullName: 'NGƯỜI KIỂM THỬ', dateOfBirth: '2000-02-01' }),
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.role = 'Staff';
  mocks.request.mockResolvedValue({ available: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function capture() {
  const button = screen.getByRole('button', { name: /^(Chụp ảnh OCR|Chụp lại)$/ });
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
  await waitFor(() => expect(mocks.image).toHaveBeenCalled());
}

it('starts with one prominent camera action and no six-profile selector', async () => {
  render(<OcrTest />);
  expect(screen.getByRole('button', { name: 'Chụp ảnh OCR' })).toHaveAttribute(
    'data-mode',
    'contained',
  );
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByText('CCCD · Mặt trước')).toBeNull();
  expect(mocks.protect).toHaveBeenCalledWith('ocr-test');
});
it('sends an untyped image, displays the detected side, preview and editable results', async () => {
  mocks.image.mockResolvedValue({ analysis: front() });
  render(<OcrTest />);
  await capture();
  const name = await screen.findByLabelText('Họ và tên');
  expect(name).toHaveValue('NGƯỜI KIỂM THỬ');
  expect(screen.getByLabelText('Ngày sinh')).toHaveValue('01/02/2000');
  expect(mocks.image.mock.calls[0][0]).toBe('/api/v1/ocr/diagnostics/auto');
  expect(screen.getByText('Loại ảnh nhận diện: CCCD · Mặt trước')).toBeTruthy();
  fireEvent.change(name, { target: { value: 'ĐÃ SỬA TẠM' } });
  expect(name).toHaveValue('ĐÃ SỬA TẠM');
  expect(screen.getByAltText('Ảnh vừa chụp để đối chiếu')).toHaveAttribute(
    'src',
    'data:image/jpeg;base64,AQID',
  );
  expect(screen.queryByRole('combobox')).toBeNull();
});
it('allows manual result correction when a known category has no extracted fields', async () => {
  mocks.image.mockResolvedValue({
    analysis: {
      ...unknown('classified'),
      detectedCategory: 'water_digital',
      meterProposal: { ...proposal({}), isFallback: true },
    },
  });
  render(<OcrTest />);
  await capture();
  const reading = await screen.findByLabelText('Chỉ số đồng hồ');
  expect(reading).toHaveValue('');
  fireEvent.change(reading, { target: { value: '00123.45' } });
  expect(reading).toHaveValue('00123.45');
  expect(mocks.image).toHaveBeenCalledTimes(1);
});
it.each(['unknown', 'ambiguous', 'unavailable'] as const)(
  'shows manual category selection only after %s',
  async (status) => {
    mocks.image.mockResolvedValue({ analysis: unknown(status) });
    render(<OcrTest />);
    expect(screen.queryByRole('combobox')).toBeNull();
    await capture();
    expect(await screen.findByLabelText('Loại ảnh sau khi kiểm tra')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Đọc theo loại đã chọn' })).toBeDisabled();
  },
);
it('reuses the same temporary image for explicit classification and server precision after ambiguity', async () => {
  mocks.image
    .mockResolvedValueOnce({ analysis: unknown() })
    .mockResolvedValueOnce({ proposal: proposal({ reading: '00123.4' }) });
  render(<OcrTest />);
  await capture();
  fireEvent.change(await screen.findByLabelText('Loại ảnh sau khi kiểm tra'), {
    target: { value: 'electricity-digital' },
  });
  fireEvent.change(screen.getByLabelText('Số chữ số thập phân thực tế'), {
    target: { value: '1' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Đọc theo loại đã chọn' }));
  expect(await screen.findByLabelText('Chỉ số đồng hồ')).toHaveValue('00123.4');
  expect(mocks.image.mock.calls[1][0]).toBe(
    '/api/v1/ocr/diagnostics/electricity-digital?decimalPlaces=1',
  );
  expect(screen.getByText('Loại ảnh đã chọn: Điện · Điện tử')).toBeTruthy();
  expect(mocks.image.mock.calls[1][1]).toBe(mocks.image.mock.calls[0][1]);
  expect([...mocks.image.mock.calls[0][1]]).toEqual([0, 0, 0]);
});
it('ignores a late response after backgrounding and zeroes the owned image', async () => {
  let finish!: (value: unknown) => void;
  mocks.image.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<OcrTest />);
  await capture();
  act(() => mocks.onState?.('background'));
  await act(async () => finish({ analysis: front() }));
  expect(screen.queryByLabelText('Họ và tên')).toBeNull();
  expect(screen.queryByAltText('Ảnh vừa chụp để đối chiếu')).toBeNull();
  expect([...mocks.image.mock.calls[0][1]]).toEqual([0, 0, 0]);
  expect(mocks.image.mock.calls[0][2].aborted).toBe(true);
});
it('clears a previous result on recapture and offers review after inference failure', async () => {
  mocks.image
    .mockResolvedValueOnce({ analysis: front() })
    .mockRejectedValueOnce(new Error('unavailable'));
  render(<OcrTest />);
  await capture();
  await screen.findByLabelText('Họ và tên');
  await capture();
  expect(await screen.findByLabelText('Loại ảnh sau khi kiểm tra')).toBeTruthy();
  expect(screen.queryByLabelText('Họ và tên')).toBeNull();
  expect(mocks.image).toHaveBeenCalledTimes(2);
});
it('expires unknown images and results after the bounded review interval', async () => {
  mocks.image.mockResolvedValue({ analysis: unknown() });
  render(<OcrTest />);
  await capture();
  await screen.findByLabelText('Loại ảnh sau khi kiểm tra');
  vi.useFakeTimers();
  // Start a fresh capture so its expiry uses the controlled clock.
  fireEvent.click(screen.getByRole('button', { name: 'Chụp lại' }));
  await act(async () => {});
  act(() => vi.advanceTimersByTime(60001));
  expect(screen.queryByRole('combobox')).toBeNull();
  expect(screen.queryByAltText('Ảnh vừa chụp để đối chiếu')).toBeNull();
  expect([...mocks.image.mock.calls[1][1]]).toEqual([0, 0, 0]);
});
it('clears the temporary image when unmounted and rejects unauthorized roles', async () => {
  mocks.image.mockResolvedValue({ analysis: unknown() });
  const view = render(<OcrTest />);
  await capture();
  await screen.findByLabelText('Loại ảnh sau khi kiểm tra');
  view.unmount();
  expect([...mocks.image.mock.calls[0][1]]).toEqual([0, 0, 0]);
  mocks.role = 'Tenant';
  render(<OcrTest />);
  expect(screen.queryByRole('button', { name: 'Chụp ảnh OCR' })).toBeNull();
});
it('does not expose manual retry after a permission denial', async () => {
  mocks.image.mockRejectedValue(new MobileApiError(403));
  render(<OcrTest />);
  await capture();
  await waitFor(() => expect(screen.queryByAltText('Ảnh vừa chụp để đối chiếu')).toBeNull());
  expect(screen.queryByRole('combobox')).toBeNull();
});
