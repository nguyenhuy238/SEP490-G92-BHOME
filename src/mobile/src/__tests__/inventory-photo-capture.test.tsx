// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { IncidentPhoto } from '../services/incidents';

const state = vi.hoisted(() => ({
  uuid: 0,
  imageBytes: vi.fn(),
}));
vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  View: ({ children }: { children: React.ReactNode }) => {
    // React Native Web warns if even an empty string is a direct child of View.
    // Keep this regression to catch truthy/falsy JSX accidentally returning ''.
    if (React.Children.toArray(children).some((child) => typeof child === 'string'))
      throw new Error('Unexpected text node: A text node cannot be a child of a View');
    return <div>{children}</div>;
  },
  Image: ({
    accessibilityLabel,
    source,
  }: {
    accessibilityLabel: string;
    source: { uri: string };
  }) => <img alt={accessibilityLabel} src={source.uri} />,
}));
vi.mock('react-native-paper', () => ({
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    accessibilityLabel,
    onPress,
    disabled,
  }: {
    children: React.ReactNode;
    accessibilityLabel?: string;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button aria-label={accessibilityLabel} onClick={onPress} disabled={disabled}>
      {children}
    </button>
  ),
  IconButton: ({
    accessibilityLabel,
    onPress,
    disabled,
  }: {
    accessibilityLabel: string;
    onPress: () => void;
    disabled?: boolean;
  }) => (
    <button aria-label={accessibilityLabel} onClick={onPress} disabled={disabled}>
      ×
    </button>
  ),
}));
vi.mock('../theme/theme', () => ({
  colors: { white: '#ffffff', navy: '#001637', muted: '#64748b', red: '#ba1a1a' },
}));
vi.mock('../components/IncidentEvidencePicker', () => ({
  incidentPhotoUri: () => 'data:image/png;base64,iVBORw0KGgo=',
}));
vi.mock('../components/CameraCapture', () => ({
  CameraCapture: ({
    label,
    disabled,
    onCapture,
  }: {
    label: string;
    disabled?: boolean;
    onCapture: (bytes: Uint8Array<ArrayBuffer>) => Promise<boolean>;
  }) => (
    <button
      disabled={disabled}
      onClick={() => {
        const source = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        void onCapture(source).then(() => source.fill(0));
      }}
    >
      {label}
    </button>
  ),
}));
vi.mock('../lib/randomUUID', () => ({
  randomUUID: () => `00000000-0000-4000-8000-${String(++state.uuid).padStart(12, '0')}`,
}));
vi.mock('../services/operationalTasks', () => ({
  operationalTasks: () => ({ imageBytes: state.imageBytes }),
}));
import { InventoryPhotoCapture } from '../components/InventoryPhotoCapture';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  state.uuid = 0;
});
const request = vi.fn();
const api = { request } as never;

function Fixture({
  saved = [] as string[],
  developmentDemo = false,
}: {
  saved?: string[];
  developmentDemo?: boolean;
}) {
  const [photos, setPhotos] = useState<IncidentPhoto[]>([]);
  const [savedIds, setSavedIds] = useState(saved);
  return (
    <InventoryPhotoCapture
      api={api}
      taskId="11111111-1111-4111-8111-111111111111"
      savedIds={savedIds}
      developmentDemo={developmentDemo}
      photos={photos}
      disabled={false}
      onChange={setPhotos}
      onRemoveSaved={(id) => setSavedIds((ids) => ids.filter((x) => x !== id))}
    />
  );
}

it('has only a camera action, appends immediate image previews, caps at 5 and removes them with X', async () => {
  render(<Fixture />);
  expect(screen.getByText('Ảnh minh chứng *')).toBeTruthy();
  expect(screen.queryByText('Chọn ảnh từ thư viện')).toBeNull();
  for (let i = 1; i <= 5; i++) {
    fireEvent.click(screen.getByRole('button', { name: 'Chụp ảnh' }));
    await waitFor(() => expect(screen.getAllByRole('img')).toHaveLength(i));
  }
  expect(screen.getByRole('button', { name: 'Chụp ảnh' })).toHaveProperty('disabled', true);
  expect(screen.getAllByRole('img')[0]?.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
  fireEvent.click(screen.getByRole('button', { name: 'Xóa ảnh minh chứng 2' }));
  expect(screen.getAllByRole('img')).toHaveLength(4);
  expect(screen.getByRole('button', { name: 'Chụp ảnh' })).toHaveProperty('disabled', false);
});

it('floats outside the inventory form and adds only local draft photos up to the limit', () => {
  vi.stubGlobal('__DEV__', true);
  vi.stubGlobal('location', { hostname: 'localhost', port: '8081' });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    fillRect: vi.fn(),
    fillText: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(
    `data:image/jpeg;base64,${btoa(String.fromCharCode(0xff, 0xd8, 0xff, ...Array(140).fill(0)))}`,
  );
  render(<Fixture developmentDemo />);
  const floating = screen.getByRole('group', { name: 'Công cụ ảnh mẫu DEV' });
  expect(floating.parentElement).toBe(document.body);
  expect(floating.style.position).toBe('fixed');
  fireEvent.click(screen.getByRole('button', { name: 'Ẩn công cụ ảnh mẫu DEV' }));
  expect(screen.queryByRole('button', { name: 'Thêm ảnh mẫu DEV' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Mở công cụ ảnh mẫu DEV' }));
  expect(screen.queryAllByRole('img')).toHaveLength(0);
  for (let i = 0; i < 5; i++) {
    fireEvent.click(screen.getByRole('button', { name: 'Thêm ảnh mẫu DEV' }));
  }
  expect(screen.getAllByRole('img')).toHaveLength(5);
  expect(screen.getByRole('button', { name: 'Thêm ảnh mẫu DEV' })).toHaveProperty('disabled', true);
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Ẩn công cụ ảnh mẫu DEV' }));
  expect(screen.getByRole('button', { name: 'Mở công cụ ảnh mẫu DEV' })).toBeTruthy();
});

it('loads stored photos through authenticated task evidence and unlinks by X', async () => {
  const savedId = '33333333-3333-4333-8333-333333333333';
  state.imageBytes.mockResolvedValue(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));
  render(<Fixture saved={[savedId]} />);
  expect(await screen.findByRole('img', { name: 'Ảnh minh chứng đã lưu' })).toBeTruthy();
  expect(state.imageBytes).toHaveBeenCalledWith(
    '11111111-1111-4111-8111-111111111111',
    savedId,
    expect.any(AbortSignal),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xóa ảnh minh chứng 1' }));
  expect(screen.queryByRole('img', { name: 'Ảnh minh chứng đã lưu' })).toBeNull();
});
