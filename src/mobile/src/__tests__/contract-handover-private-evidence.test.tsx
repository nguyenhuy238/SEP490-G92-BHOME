// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  contractClient,
  type ContractClient,
} from '../../../../packages/client-core/src/contracts';

const state = vi.hoisted(() => ({
  platform: 'web',
  transport: vi.fn(),
  handoverDocument: vi.fn(),
  handoverDocumentBytes: vi.fn(),
  sharingAvailable: vi.fn(),
  share: vi.fn(),
  write: vi.fn(),
  remove: vi.fn(),
}));

vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return state.platform;
    },
  },
  View: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Image: ({
    source,
    accessibilityLabel,
  }: {
    source: { uri: string };
    accessibilityLabel: string;
  }) => <img src={source.uri} alt={accessibilityLabel} />,
}));
vi.mock('react-native-paper', () => ({
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
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('../components/WorkspaceKit', () => ({ ui: { red: {} } }));
vi.mock('../lib/randomUUID', () => ({ randomUUID: () => '60000000-0000-4000-8000-000000000001' }));
vi.mock('../lib/useFeedbackState', () => ({ useFeedbackState: () => React.useState('') }));
vi.mock('expo-sharing', () => ({
  isAvailableAsync: state.sharingAvailable,
  shareAsync: state.share,
}));
vi.mock('expo-file-system', () => ({
  Paths: { cache: '/private-cache' },
  Directory: class {
    create() {
      /* no-op: test private cache */
    }
  },
  File: class {
    uri = 'file:///private-cache/temporary.pdf';
    exists = true;
    create() {
      /* no-op */
    }
    write(bytes: Uint8Array) {
      state.write(bytes);
    }
    delete() {
      state.remove();
    }
  },
}));

import { ContractEvidence } from '../features/contracts/ContractEvidence';

const contractId = '00000000-0000-4000-8000-000000000001';
const evidenceId = '20000000-0000-4000-8000-000000000002';
const documentId = '30000000-0000-4000-8000-000000000003';
const finalReadingId = '40000000-0000-4000-8000-000000000008';
const finalMeterPath = `/api/v1/contracts/${contractId}/move-out/meter-evidence/${finalReadingId}`;
const api = {
  transport: state.transport,
  handoverDocument: state.handoverDocument,
  handoverDocumentBytes: state.handoverDocumentBytes,
} as unknown as ContractClient;
const finalApi = contractClient(
  <T,>(path: string, init?: RequestInit, responseType?: 'json' | 'blob' | 'bytes') =>
    state.transport(path, init, responseType) as Promise<T>,
);

// jsdom's Blob does not implement arrayBuffer(), unlike browser Blob.
function browserBlob(bytes: Uint8Array, type: string) {
  const supportedBytes = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  supportedBytes.set(bytes);
  const blob = new Blob([supportedBytes], { type });
  Object.defineProperty(blob, 'slice', {
    value: () => ({ arrayBuffer: async () => supportedBytes.buffer }),
  });
  return blob;
}

beforeEach(() => {
  state.platform = 'web';
  state.sharingAvailable.mockResolvedValue(true);
  state.share.mockResolvedValue(undefined);
  state.transport.mockResolvedValue(
    browserBlob(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'),
  );
  state.handoverDocument.mockResolvedValue(
    new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' }),
  );
  state.handoverDocumentBytes.mockResolvedValue(new Uint8Array([37, 80, 68, 70]));
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: vi.fn(() => 'blob:private-test'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('previews and downloads an authenticated draft photo, revoking its private blob URL on close', async () => {
  render(
    <ContractEvidence
      api={api}
      contractId={contractId}
      draftHandoverEvidence
      evidenceId={evidenceId}
      label="Xem ảnh riêng tư"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh riêng tư' }));
  await waitFor(() =>
    expect(state.transport).toHaveBeenCalledWith(
      `/api/v1/contracts/${contractId}/handover/draft/evidence/${evidenceId}`,
      { signal: expect.any(AbortSignal) },
      'blob',
    ),
  );
  const image = await screen.findByRole('img', { name: 'Xem ảnh riêng tư' });
  expect(image.getAttribute('src')).toBe('blob:private-test');
  expect(URL.createObjectURL).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng ảnh' }));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-test');
  expect(screen.queryByRole('img')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Tải ảnh' }));
  await waitFor(() => expect(state.transport).toHaveBeenCalledTimes(2));
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
  expect(state.handoverDocument).not.toHaveBeenCalled();
});

it('shows a real private photo thumbnail without public URLs and cleans the browser blob on unmount', async () => {
  const { unmount } = render(
    <ContractEvidence
      api={api}
      contractId={contractId}
      draftHandoverEvidence
      evidenceId={evidenceId}
      thumbnail
      label="Ảnh khu vực"
    />,
  );
  const image = await screen.findByRole('img', { name: 'Ảnh khu vực' });
  expect(image.getAttribute('src')).toBe('blob:private-test');
  expect(state.transport).toHaveBeenCalledWith(
    `/api/v1/contracts/${contractId}/handover/draft/evidence/${evidenceId}`,
    { signal: expect.any(AbortSignal) },
    'blob',
  );
  expect(screen.queryByRole('button', { name: 'Tải ảnh' })).toBeNull();
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-test');
});

it('shares one authenticated fetch and one object URL across duplicate mounted photo thumbnails', async () => {
  const left = render(
    <ContractEvidence
      api={finalApi}
      contractId={contractId}
      evidenceId={evidenceId}
      thumbnail
      label="Bản sao một"
    />,
  );
  const right = render(
    <ContractEvidence
      api={finalApi}
      contractId={contractId}
      evidenceId={evidenceId}
      thumbnail
      label="Bản sao hai"
    />,
  );
  expect(await screen.findByRole('img', { name: 'Bản sao một' })).toBeTruthy();
  expect(await screen.findByRole('img', { name: 'Bản sao hai' })).toBeTruthy();
  expect(state.transport).toHaveBeenCalledExactlyOnceWith(
    `/api/v1/contracts/${contractId}/move-out/evidence/${evidenceId}`,
    { signal: expect.any(AbortSignal), headers: { Accept: 'application/octet-stream' } },
    'blob',
  );
  expect(URL.createObjectURL).toHaveBeenCalledOnce();
  left.unmount();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  right.unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:private-test');
});

it('does not reuse private images across different authenticated client instances', async () => {
  const anotherClient = contractClient(
    <T,>(path: string, init?: RequestInit, responseType?: 'json' | 'blob' | 'bytes') =>
      state.transport(path, init, responseType) as Promise<T>,
  );
  render(
    <ContractEvidence
      api={finalApi}
      contractId={contractId}
      evidenceId={evidenceId}
      thumbnail
      label="Phiên A"
    />,
  );
  render(
    <ContractEvidence
      api={anotherClient}
      contractId={contractId}
      evidenceId={evidenceId}
      thumbnail
      label="Phiên B"
    />,
  );
  expect(await screen.findByRole('img', { name: 'Phiên A' })).toBeTruthy();
  expect(await screen.findByRole('img', { name: 'Phiên B' })).toBeTruthy();
  expect(state.transport).toHaveBeenCalledTimes(2);
  expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
});

it('limits concurrent authenticated thumbnail downloads to four', async () => {
  const pending: Array<(blob: Blob) => void> = [];
  state.transport.mockImplementation(
    () =>
      new Promise<Blob>((resolve) => {
        pending.push(resolve);
      }),
  );
  const ids = [1, 2, 3, 4, 5].map((n) => `30000000-0000-4000-8000-00000000000${n}`);
  render(
    <>
      {ids.map((id) => (
        <ContractEvidence
          key={id}
          api={finalApi}
          contractId={contractId}
          evidenceId={id}
          thumbnail
          label={id}
        />
      ))}
    </>,
  );
  await waitFor(() => expect(pending).toHaveLength(4));
  const image = () => browserBlob(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png');
  pending[0](image());
  await waitFor(() => expect(pending).toHaveLength(5));
  pending.slice(1).forEach((resolve) => resolve(image()));
  for (const id of ids) expect(await screen.findByRole('img', { name: id })).toBeTruthy();
});

it('previews confirmed initial meter photo in the handover detail without offering download', async () => {
  const meter = vi
    .fn()
    .mockResolvedValue(browserBlob(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'));
  const { unmount } = render(
    <ContractEvidence
      api={{ ...api, handoverMeterEvidence: meter } as ContractClient}
      contractId={contractId}
      readingId="40000000-0000-4000-8000-000000000008"
      thumbnail
      thumbnailHeight={240}
      label="Ảnh công tơ điện"
    />,
  );
  const image = await screen.findByRole('img', { name: 'Ảnh công tơ điện' });
  expect(image.getAttribute('src')).toBe('blob:private-test');
  expect(meter).toHaveBeenCalledWith(
    contractId,
    '40000000-0000-4000-8000-000000000008',
    expect.any(AbortSignal),
  );
  expect(state.transport).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Tải ảnh' })).toBeNull();
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-test');
});

it('loads a Tenant final meter thumbnail only from the authenticated contract-scoped Blob endpoint', async () => {
  const { unmount } = render(
    <ContractEvidence
      api={finalApi}
      contractId={contractId}
      readingId={finalReadingId}
      finalMeterReading
      thumbnail
      label="Ảnh công tơ chốt"
    />,
  );
  const image = await screen.findByRole('img', { name: 'Ảnh công tơ chốt' });
  expect(image.getAttribute('src')).toBe('blob:private-test');
  expect(state.transport).toHaveBeenCalledExactlyOnceWith(
    finalMeterPath,
    { signal: expect.any(AbortSignal) },
    'blob',
  );
  expect(
    state.transport.mock.calls.some(([path]) => String(path).startsWith('/api/v1/capture/')),
  ).toBe(false);
  unmount();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private-test');
});

it('uses the same contract-scoped endpoint when opening the final meter image on web', async () => {
  render(
    <ContractEvidence
      api={finalApi}
      contractId={contractId}
      readingId={finalReadingId}
      finalMeterReading
      label="Mở ảnh công tơ chốt"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mở ảnh công tơ chốt' }));
  await waitFor(() =>
    expect(state.transport).toHaveBeenCalledExactlyOnceWith(
      finalMeterPath,
      { signal: expect.any(AbortSignal) },
      'blob',
    ),
  );
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
});

it('reads final meter evidence as authenticated native bytes for both thumbnail and share', async () => {
  state.platform = 'android';
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  state.transport.mockResolvedValue(bytes);
  const { unmount } = render(
    <ContractEvidence
      api={finalApi}
      contractId={contractId}
      readingId={finalReadingId}
      finalMeterReading
      thumbnail
      label="Ảnh số chốt trên máy"
    />,
  );
  expect(await screen.findByRole('img', { name: 'Ảnh số chốt trên máy' })).toBeTruthy();
  expect(state.transport).toHaveBeenCalledExactlyOnceWith(
    finalMeterPath,
    { signal: expect.any(AbortSignal) },
    'bytes',
  );
  expect(state.write).toHaveBeenCalledWith(bytes);
  unmount();
  expect(state.remove).toHaveBeenCalledOnce();

  render(
    <ContractEvidence
      api={finalApi}
      contractId={contractId}
      readingId={finalReadingId}
      finalMeterReading
      label="Mở ảnh số chốt"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mở ảnh số chốt' }));
  await waitFor(() => expect(state.share).toHaveBeenCalledOnce());
  expect(state.transport).toHaveBeenLastCalledWith(
    finalMeterPath,
    { signal: expect.any(AbortSignal) },
    'bytes',
  );
  expect(state.share).toHaveBeenCalledWith(
    'file:///private-cache/temporary.pdf',
    expect.objectContaining({ mimeType: 'image/png' }),
  );
  expect(state.transport.mock.calls.every(([path]) => path === finalMeterPath)).toBe(true);
});

it('shows Tenant authorization errors for final meter evidence without falling back to Capture', async () => {
  state.transport.mockRejectedValue({ status: 403, code: 'forbidden' });
  render(
    <ContractEvidence
      api={finalApi}
      contractId={contractId}
      readingId={finalReadingId}
      finalMeterReading
      thumbnail
    />,
  );
  expect(
    await screen.findByText('Tài khoản không có quyền xem ảnh công tơ chốt của hợp đồng này.'),
  ).toBeTruthy();
  expect(state.transport).toHaveBeenCalledExactlyOnceWith(
    finalMeterPath,
    { signal: expect.any(AbortSignal) },
    'blob',
  );
  expect(screen.queryByRole('img')).toBeNull();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(state.share).not.toHaveBeenCalled();
});

it('does not download or share denied Tenant final evidence on either platform', async () => {
  state.transport.mockRejectedValue({ status: 403, code: 'forbidden' });
  const web = render(
    <ContractEvidence
      api={finalApi}
      contractId={contractId}
      readingId={finalReadingId}
      finalMeterReading
      label="Mở ảnh số chốt"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mở ảnh số chốt' }));
  expect(
    await screen.findByText('Tài khoản không có quyền xem ảnh công tơ chốt của hợp đồng này.'),
  ).toBeTruthy();
  expect(state.transport).toHaveBeenCalledExactlyOnceWith(
    finalMeterPath,
    { signal: expect.any(AbortSignal) },
    'blob',
  );
  expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  web.unmount();

  state.platform = 'ios';
  state.transport.mockClear();
  state.transport.mockRejectedValue({ status: 401, code: 'unauthorized' });
  render(
    <ContractEvidence
      api={finalApi}
      contractId={contractId}
      readingId={finalReadingId}
      finalMeterReading
      label="Mở ảnh số chốt"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mở ảnh số chốt' }));
  expect(await screen.findByText('Vui lòng đăng nhập lại để xem ảnh công tơ chốt.')).toBeTruthy();
  expect(state.transport).toHaveBeenCalledExactlyOnceWith(
    finalMeterPath,
    { signal: expect.any(AbortSignal) },
    'bytes',
  );
  expect(state.share).not.toHaveBeenCalled();
  expect(state.write).not.toHaveBeenCalled();
});

it('preserves the Owner/Staff capture reading client method separately from Tenant final evidence', async () => {
  await finalApi.readingEvidence(finalReadingId);
  expect(state.transport).toHaveBeenCalledExactlyOnceWith(
    `/api/v1/capture/readings/${finalReadingId}/evidence`,
    { signal: undefined },
    'blob',
  );
});

it('shows an unsaved photo immediately from the local preview without fetching a not-yet-linked private file', () => {
  render(
    <ContractEvidence
      api={api}
      contractId={contractId}
      draftHandoverEvidence
      evidenceId={evidenceId}
      thumbnail
      localThumbnailUri="blob:unsaved-photo"
      label="Ảnh vừa chụp"
    />,
  );
  expect(screen.getByRole('img', { name: 'Ảnh vừa chụp' }).getAttribute('src')).toBe(
    'blob:unsaved-photo',
  );
  expect(state.transport).not.toHaveBeenCalled();
});

it('uses an ephemeral private cached file for native thumbnails and deletes it on unmount', async () => {
  state.platform = 'android';
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  state.transport.mockResolvedValue(bytes);
  const { unmount } = render(
    <ContractEvidence
      api={api}
      contractId={contractId}
      draftHandoverEvidence
      evidenceId={evidenceId}
      thumbnail
      label="Ảnh trên điện thoại"
    />,
  );
  expect(await screen.findByRole('img', { name: 'Ảnh trên điện thoại' })).toBeTruthy();
  expect(state.transport).toHaveBeenCalledWith(
    `/api/v1/contracts/${contractId}/handover/draft/evidence/${evidenceId}`,
    { signal: expect.any(AbortSignal) },
    'bytes',
  );
  expect(state.write).toHaveBeenCalledWith(bytes);
  unmount();
  expect(state.remove).toHaveBeenCalledOnce();
});

it('opens the immutable PDF via authenticated final document endpoint on web', async () => {
  render(
    <ContractEvidence
      api={api}
      contractId={contractId}
      handoverDocumentId={documentId}
      label="PDF cuối cùng"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'PDF cuối cùng' }));
  await waitFor(() =>
    expect(state.handoverDocument).toHaveBeenCalledWith(
      contractId,
      documentId,
      expect.any(AbortSignal),
    ),
  );
  expect(state.transport).not.toHaveBeenCalled();
  expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledOnce();
});

it('shares protected image bytes on native and deletes the temporary file', async () => {
  state.platform = 'ios';
  const bytes = new Uint8Array([137, 80, 78, 71]);
  state.transport.mockResolvedValue(bytes);
  render(
    <ContractEvidence
      api={api}
      contractId={contractId}
      draftHandoverEvidence
      evidenceId={evidenceId}
      label="Mở ảnh"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Mở ảnh' }));
  await waitFor(() =>
    expect(state.transport).toHaveBeenCalledWith(
      `/api/v1/contracts/${contractId}/handover/draft/evidence/${evidenceId}`,
      { signal: expect.any(AbortSignal) },
      'bytes',
    ),
  );
  await waitFor(() =>
    expect(state.share).toHaveBeenCalledWith(
      'file:///private-cache/temporary.pdf',
      expect.objectContaining({ mimeType: 'image/png' }),
    ),
  );
  expect(state.write).toHaveBeenCalledWith(bytes);
  expect(state.remove).toHaveBeenCalledOnce();
});

it('reports restricted evidence without opening a preview or sharing private bytes', async () => {
  state.transport.mockRejectedValue({ status: 403, code: 'forbidden' });
  render(
    <ContractEvidence
      api={api}
      contractId={contractId}
      draftHandoverEvidence
      evidenceId={evidenceId}
      label="Xem ảnh riêng tư"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh riêng tư' }));
  await waitFor(() => expect(state.transport).toHaveBeenCalledOnce());
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(state.share).not.toHaveBeenCalled();
});

it('rejects HTML masquerading as a private image instead of rendering it inline', async () => {
  state.transport.mockResolvedValue(
    browserBlob(new TextEncoder().encode('<script>alert(1)</script>'), 'text/html'),
  );
  render(
    <ContractEvidence
      api={api}
      contractId={contractId}
      draftHandoverEvidence
      evidenceId={evidenceId}
      label="Xem ảnh riêng tư"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh riêng tư' }));
  expect(await screen.findByText(/không phải PNG hoặc JPEG hợp lệ/)).toBeTruthy();
  expect(screen.queryByRole('img')).toBeNull();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

it('masks runtime details during private preview and allows retry after failure', async () => {
  state.transport.mockRejectedValueOnce(new Error('Native filesystem password=secret failed'));
  render(
    <ContractEvidence
      api={api}
      contractId={contractId}
      draftHandoverEvidence
      evidenceId={evidenceId}
      label="Thử mở ảnh"
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Thử mở ảnh' }));
  await waitFor(() => expect(state.transport).toHaveBeenCalledOnce());
  expect(await screen.findByText(/Không kết nối được máy chủ/)).toBeTruthy();
  expect(screen.queryByText(/password=secret/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Thử mở ảnh' }));
  expect(await screen.findByRole('img', { name: 'Thử mở ảnh' })).toBeTruthy();
  expect(state.transport).toHaveBeenCalledTimes(2);
});
