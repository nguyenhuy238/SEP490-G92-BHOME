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
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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
  state.uuid = 0;
});
const api = { request: vi.fn() } as never;

function Fixture({ saved = [] as string[] }: { saved?: string[] }) {
  const [photos, setPhotos] = useState<IncidentPhoto[]>([]);
  const [savedIds, setSavedIds] = useState(saved);
  return (
    <InventoryPhotoCapture
      api={api}
      taskId="11111111-1111-4111-8111-111111111111"
      savedIds={savedIds}
      photos={photos}
      disabled={false}
      onChange={setPhotos}
      onRemoveSaved={(id) => setSavedIds((ids) => ids.filter((x) => x !== id))}
    />
  );
}

it('has only a camera action, appends immediate image previews, caps at 5 and removes them with X', async () => {
  render(<Fixture />);
  expect(screen.getByText('Ảnh minh chứng:')).toBeTruthy();
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
