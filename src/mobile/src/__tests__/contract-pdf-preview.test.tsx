// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const native = vi.hoisted(() => ({ listeners: new Set<(state: string) => void>() }));
vi.mock('react-native', () => ({
  StyleSheet: { create: (s: unknown) => s },
  useWindowDimensions: () => ({ width: 320, height: 640 }),
  Keyboard: { dismiss: vi.fn() },
  AppState: {
    addEventListener: (_: string, cb: (state: string) => void) => {
      native.listeners.add(cb);
      return { remove: () => native.listeners.delete(cb) };
    },
  },
  View: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ScrollView: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Modal: ({ children }: { children?: React.ReactNode }) => (
    <div role="dialog">
      <button onClick={() => {}}>Native window</button>
      {children}
    </div>
  ),
  Image: ({
    source,
    accessibilityLabel,
    onError,
    style,
  }: {
    source: { uri: string };
    accessibilityLabel: string;
    onError: () => void;
    style: React.CSSProperties;
  }) => <img src={source.uri} alt={accessibilityLabel} onError={onError} style={style} />,
  FlatList: ({
    data,
    renderItem,
  }: {
    data: { number: number }[];
    renderItem: (item: { item: { number: number } }) => React.ReactNode;
  }) => (
    <div>
      {data.map((item) => (
        <div key={item.number}>{renderItem({ item })}</div>
      ))}
    </div>
  ),
}));
vi.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SafeAreaView: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('react-native-paper', () => ({
  MD3LightTheme: { colors: {} },
  configureFonts: () => ({}),
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  ActivityIndicator: ({ accessibilityLabel }: { accessibilityLabel?: string }) => (
    <span>{accessibilityLabel ?? 'Loading'}</span>
  ),
  Icon: () => null,
  Button: ({
    children,
    disabled,
    onPress,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onPress: () => void;
  }) => (
    <button disabled={disabled} onClick={onPress}>
      {children}
    </button>
  ),
  IconButton: ({
    accessibilityLabel,
    disabled,
    onPress,
  }: {
    accessibilityLabel: string;
    disabled?: boolean;
    onPress: () => void;
  }) => <button aria-label={accessibilityLabel} disabled={disabled} onClick={onPress} />,
}));
import { ContractPdfPreview } from '../features/contracts/ContractPdfPreview';
import { mainDraftClient } from '../../../../packages/client-core/src/mainDrafts';
const png = () => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const info = (id = 'pdf') => ({
  fileId: id,
  pages: [1, 2, 3].map((number) => ({ number, width: 595, height: 842 })),
});
const document = (id = 'pdf') => ({
  id,
  contractId: 'contract',
  kind: 'DraftPdf',
  snapshotHash: 'snapshot',
  templateId: 'template',
  templateVersion: 1,
  developmentOnly: true,
  recordedAt: '',
});
const request = vi.fn();
const client = mainDraftClient(request);
const props = () => ({
  client,
  contractId: 'contract',
  document: document(),
  busy: false,
  previewErrorCode: null,
  hasDocx: true,
  onRegenerate: vi.fn(),
  onOpenPdf: vi.fn(),
  onOpenDocx: vi.fn(),
});
beforeEach(() => {
  vi.clearAllMocks();
  request.mockImplementation(async (path: string) =>
    path.endsWith('/preview') ? info(path.includes('/new-pdf/') ? 'new-pdf' : 'pdf') : png(),
  );
});
afterEach(cleanup);

it('loads authenticated page bytes into a real inline preview, opens all pages and zooms in fullscreen', async () => {
  const options = props();
  render(<ContractPdfPreview {...options} />);
  const first = await screen.findByAltText('Trang 1 của hợp đồng PDF');
  expect(first.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgoA');
  expect(request).toHaveBeenCalledWith(
    '/api/v1/contracts/main-drafts/contract/documents/pdf/pages/1',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
    'bytes',
  );
  expect(request.mock.calls.some(([path]) => path.endsWith('/pages/2'))).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Xem toàn màn hình' }));
  await screen.findByAltText('Trang 3 của hợp đồng PDF');
  const before = (screen.getByAltText('Trang 1 của hợp đồng PDF') as HTMLImageElement).style.width;
  fireEvent.click(screen.getByRole('button', { name: 'Phóng to hợp đồng' }));
  expect(screen.getByText('3 trang · 150%')).toBeTruthy();
  expect(
    (screen.getByAltText('Trang 1 của hợp đồng PDF') as HTMLImageElement).style.width,
  ).not.toBe(before);
  fireEvent.click(screen.getByRole('button', { name: 'Đóng xem toàn màn hình' }));
  await screen.findByAltText('Trang 1 của hợp đồng PDF');
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Tải hoặc mở PDF' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mở hoặc lưu DOCX' }));
  expect(options.onOpenPdf).toHaveBeenCalledOnce();
  expect(options.onOpenDocx).toHaveBeenCalledOnce();
});
it('shows a loading state on slow networks, retries authorization/API failures and preserves external fallback', async () => {
  request.mockRejectedValueOnce({ status: 401 });
  render(<ContractPdfPreview {...props()} />);
  expect(screen.getByText('Đang tải bản xem trước…')).toBeTruthy();
  await screen.findByText(/Phiên đăng nhập/);
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại bản xem trước' }));
  await screen.findByAltText('Trang 1 của hợp đồng PDF');
  expect(
    (screen.getByRole('button', { name: 'Tải hoặc mở PDF' }) as HTMLButtonElement).disabled,
  ).toBe(false);
});
it('handles missing PDF/conversion errors honestly and allows DOCX and regeneration', () => {
  const options = props();
  render(
    <ContractPdfPreview
      {...options}
      document={null}
      previewErrorCode="contract_pdf_converter_unavailable"
    />,
  );
  expect(screen.getByText(/Máy chủ chưa cấu hình LibreOffice/)).toBeTruthy();
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Thử lại bản xem trước' }));
  expect(options.onRegenerate).toHaveBeenCalledOnce();
  expect(
    (screen.getByRole('button', { name: 'Mở hoặc lưu DOCX' }) as HTMLButtonElement).disabled,
  ).toBe(false);
});
it('reports bad page bytes/decode failures, retries the page and does not render a document URL', async () => {
  request
    .mockImplementationOnce(async () => info())
    .mockImplementationOnce(async () => new Uint8Array([1, 2, 3]));
  render(<ContractPdfPreview {...props()} />);
  await screen.findByText(/Chưa hiển thị được trang PDF/);
  expect(screen.queryByRole('img')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Tải lại trang 1' }));
  const image = await screen.findByAltText('Trang 1 của hợp đồng PDF');
  fireEvent.error(image);
  await screen.findByText(/Thiết bị chưa hiển thị được trang này/);
});
it('does not show stale pages after editing regenerates the PDF and clears page state in background', async () => {
  const view = render(<ContractPdfPreview {...props()} />);
  await screen.findByAltText('Trang 1 của hợp đồng PDF');
  const oldRequest = request.mock.calls.find(([path]) => path.endsWith('/pages/1'));
  view.rerender(<ContractPdfPreview {...props()} document={document('new-pdf')} />);
  expect(screen.queryByRole('img')).toBeNull();
  await screen.findByAltText('Trang 1 của hợp đồng PDF');
  expect(oldRequest?.[1].signal.aborted).toBe(true);
  expect(request.mock.calls.some(([path]) => path.includes('/new-pdf/pages/1'))).toBe(true);
  act(() => native.listeners.forEach((cb) => cb('background')));
  expect(screen.queryByRole('img')).toBeNull();
  view.unmount();
  expect(native.listeners.size).toBe(0);
});
it('rejects mismatched file references without loading any page', async () => {
  request.mockResolvedValueOnce(info('different-file'));
  render(<ContractPdfPreview {...props()} />);
  await screen.findByText(/Bản xem trước không hợp lệ/);
  expect(request.mock.calls.some(([path]) => path.includes('/pages/'))).toBe(false);
});
