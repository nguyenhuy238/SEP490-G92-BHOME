import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { InlineHandoverEvidence } from './components/handover/InlineHandoverEvidence';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const create = vi.fn(() => 'blob:handover-image-1');
const revoke = vi.fn();

beforeEach(() => {
  create.mockClear();
  revoke.mockClear();
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
});
afterEach(() => vi.unstubAllGlobals());

it('loads private image inline without a download action, enlarges on click, and revokes the URL on unmount', async () => {
  const fetchBlob = vi.fn(async () => new Blob([png], { type: 'application/octet-stream' }));
  const view = render(
    <InlineHandoverEvidence
      imageKey="room:photo-1"
      label="Ảnh tường có vấn đề"
      fetchBlob={fetchBlob}
    />,
  );
  const photo = await screen.findByRole('img', { name: 'Ảnh tường có vấn đề' });
  expect(photo).toHaveAttribute('src', 'blob:handover-image-1');
  expect(fetchBlob).toHaveBeenCalledWith(expect.any(AbortSignal));
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/png' }));
  expect(screen.queryByRole('button', { name: /Tải xuống/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xem lớn Ảnh tường có vấn đề' }));
  expect(screen.getByRole('dialog', { name: 'Ảnh tường có vấn đề' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Đóng ảnh' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  view.unmount();
  expect(revoke).toHaveBeenCalledWith('blob:handover-image-1');
});

it.each([
  ['SVG', '<svg onload="alert(1)"/>', 'image/svg+xml'],
  ['HTML', '<html><script>alert(1)</script></html>', 'text/html'],
  ['PDF', '%PDF-1.7', 'application/pdf'],
])('never embeds an unverified %s as an image', async (_name, content, mime) => {
  render(
    <InlineHandoverEvidence
      imageKey={mime}
      label="Ảnh nghi vấn"
      fetchBlob={async () => new Blob([content], { type: mime })}
    />,
  );
  expect(await screen.findByText('Không xem được ảnh riêng tư này.')).toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Tải xuống/ })).not.toBeInTheDocument();
});

it('aborts an in-flight private request when the evidence is removed', async () => {
  let signal: AbortSignal | undefined;
  const view = render(
    <InlineHandoverEvidence
      imageKey="asset:photo"
      label="Ảnh tài sản"
      fetchBlob={async (controller) => {
        signal = controller;
        return new Promise<Blob>(() => {});
      }}
    />,
  );
  await waitFor(() => expect(signal).toBeDefined());
  view.unmount();
  expect(signal?.aborted).toBe(true);
  expect(create).not.toHaveBeenCalled();
});
