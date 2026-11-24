import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '../../../../../packages/client-core/src/api';
import { PrivateEvidenceViewer } from './PrivateEvidenceViewer';

const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
const jpeg = new Uint8Array([255, 216, 255, 224, 0, 16, 74, 70, 73, 70]);
const pdf = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n');
const makeBlob = (bytes: Uint8Array, type: string) => new Blob([new Uint8Array(bytes)], { type });
const create = vi.fn(() => `blob:private-${create.mock.calls.length}`);
const revoke = vi.fn();
const clicked: { url: string; filename: string }[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  clicked.length = 0;
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicked.push({ url: this.href, filename: this.download });
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('loads only after explicit action, previews verified PNG and revokes it on close', async () => {
  const fetchBlob = vi.fn(async () => makeBlob(png, 'application/octet-stream'));
  render(<PrivateEvidenceViewer label="chứng từ 1" filename="chung-tu" fetchBlob={fetchBlob} />);
  expect(fetchBlob).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Xem chứng từ 1' }));
  const dialog = screen.getByRole('dialog', { name: 'Xem chứng từ 1' });
  expect(await within(dialog).findByRole('img', { name: 'chứng từ 1' })).toHaveAttribute(
    'src',
    'blob:private-1',
  );
  expect(fetchBlob).toHaveBeenCalledTimes(1);
  expect(fetchBlob.mock.calls[0]).toHaveLength(1);
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/png' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Xem chứng từ 1' })).toBeNull());
  expect(revoke).toHaveBeenCalledWith('blob:private-1');
});

it('reuses verified private photo bytes on reopen and download, without repeating authenticated GET', async () => {
  const fetchBlob = vi.fn(async () => makeBlob(png, 'image/png'));
  render(
    <PrivateEvidenceViewer
      label="ảnh kiểm kê"
      filename="check.png"
      cacheKey="contract-1:photo-1"
      fetchBlob={fetchBlob}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh kiểm kê' }));
  expect(await screen.findByRole('img', { name: 'ảnh kiểm kê' })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đóng' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh kiểm kê' }));
  expect(await screen.findByRole('img', { name: 'ảnh kiểm kê' })).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đóng' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'Tải xuống ảnh kiểm kê' }));
  await waitFor(() => expect(clicked).toHaveLength(1));
  expect(fetchBlob).toHaveBeenCalledTimes(1);
  expect(create).toHaveBeenCalledTimes(3);
});

it('shows a private photo inline on the review page and expands it without downloading again', async () => {
  const fetchBlob = vi.fn(async () => makeBlob(jpeg, 'image/jpeg'));
  const result = render(
    <PrivateEvidenceViewer
      label="Ảnh trả phòng 1"
      filename="evidence.jpg"
      cacheKey="contract-1:final:photo-1"
      inlineThumbnail
      showDownload={false}
      fetchBlob={fetchBlob}
    />,
  );
  const image = await screen.findByRole('img', { name: 'Ảnh trả phòng 1' });
  expect(image).toHaveAttribute('src', 'blob:private-1');
  expect(fetchBlob).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: 'Xem Ảnh trả phòng 1' }));
  expect(
    await within(screen.getByRole('dialog')).findByRole('img', { name: 'Ảnh trả phòng 1' }),
  ).toBeInTheDocument();
  expect(fetchBlob).toHaveBeenCalledOnce();
  result.unmount();
  expect(revoke).toHaveBeenCalledWith('blob:private-1');
});

it('hides a previous contract thumbnail immediately while the next private image loads', async () => {
  let finishSecond!: (blob: Blob) => void;
  const fetchBlob = vi
    .fn()
    .mockResolvedValueOnce(makeBlob(png, 'image/png'))
    .mockImplementationOnce(
      () =>
        new Promise<Blob>((resolve) => {
          finishSecond = resolve;
        }),
    );
  const result = render(
    <PrivateEvidenceViewer
      label="ảnh phòng"
      filename="proof.jpg"
      cacheKey="contract-a:photo"
      inlineThumbnail
      showDownload={false}
      fetchBlob={fetchBlob}
    />,
  );
  expect(await screen.findByRole('img', { name: 'ảnh phòng' })).toHaveAttribute(
    'src',
    'blob:private-1',
  );

  result.rerender(
    <PrivateEvidenceViewer
      label="ảnh phòng"
      filename="proof.jpg"
      cacheKey="contract-b:photo"
      inlineThumbnail
      showDownload={false}
      fetchBlob={fetchBlob}
    />,
  );
  expect(screen.queryByRole('img', { name: 'ảnh phòng' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Xem ảnh phòng' })).toBeDisabled();
  await waitFor(() => expect(fetchBlob).toHaveBeenCalledTimes(2));
  expect(revoke).toHaveBeenCalledWith('blob:private-1');

  await act(async () => finishSecond(makeBlob(jpeg, 'image/jpeg')));
  expect(await screen.findByRole('img', { name: 'ảnh phòng' })).toHaveAttribute(
    'src',
    'blob:private-2',
  );
});

it('never embeds an unverified private file in the inline image gallery', async () => {
  const fetchBlob = vi.fn(
    async () => new Blob(['<svg onload="bad()"/>'], { type: 'image/svg+xml' }),
  );
  render(
    <PrivateEvidenceViewer
      label="Ảnh trả phòng"
      filename="fake.svg"
      cacheKey="contract-1:final:untrusted"
      inlineThumbnail
      fetchBlob={fetchBlob}
    />,
  );
  expect(await screen.findByText('Không tải được ảnh')).toBeInTheDocument();
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
});

it('limits simultaneous private gallery downloads to four while preserving later photos', async () => {
  const pending: Array<(image: Blob) => void> = [];
  const fetchBlob = vi.fn(() => new Promise<Blob>((resolve) => pending.push(resolve)));
  render(
    <>
      {Array.from({ length: 5 }, (_, index) => (
        <PrivateEvidenceViewer
          key={index}
          label={`Ảnh ${index + 1}`}
          filename={`image-${index + 1}.jpg`}
          cacheKey={`contract-a:photo-${index}`}
          inlineThumbnail
          showDownload={false}
          fetchBlob={fetchBlob}
        />
      ))}
    </>,
  );
  await waitFor(() => expect(fetchBlob).toHaveBeenCalledTimes(4));
  await act(async () => pending[0]?.(makeBlob(jpeg, 'image/jpeg')));
  await waitFor(() => expect(fetchBlob).toHaveBeenCalledTimes(5));
  await act(async () => {
    pending.forEach((done) => done(makeBlob(jpeg, 'image/jpeg')));
  });
  expect(await screen.findByRole('img', { name: 'Ảnh 5' })).toBeInTheDocument();
});

it('discards cached private photo immediately when its scoped evidence identity changes', async () => {
  const fetchBlob = vi.fn(async () => makeBlob(png, 'image/png'));
  const result = render(
    <PrivateEvidenceViewer
      label="ảnh"
      filename="proof.jpg"
      cacheKey="contract-1:proof-a"
      fetchBlob={fetchBlob}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh' }));
  expect(await screen.findByRole('img', { name: 'ảnh' })).toBeInTheDocument();
  result.rerender(
    <PrivateEvidenceViewer
      label="ảnh"
      filename="proof.jpg"
      cacheKey="contract-2:proof-b"
      fetchBlob={fetchBlob}
    />,
  );
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(revoke).toHaveBeenCalledWith('blob:private-1');
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh' }));
  expect(await screen.findByRole('img', { name: 'ảnh' })).toBeInTheDocument();
  expect(fetchBlob).toHaveBeenCalledTimes(2);
});

it('previews a verified private PDF without blocking the Chrome viewer, supports download fallback and revokes URLs', async () => {
  const fetchBlob = vi.fn(async () => makeBlob(pdf, 'application/octet-stream'));
  render(<PrivateEvidenceViewer label="biên bản" filename="bien-ban.pdf" fetchBlob={fetchBlob} />);
  fireEvent.click(screen.getByRole('button', { name: 'Xem biên bản' }));
  const frame = await screen.findByTitle('Nội dung PDF: biên bản');
  expect(frame).toHaveAttribute('src', 'blob:private-1');
  expect(frame).not.toHaveAttribute('sandbox');
  expect(frame).toHaveAttribute('referrerpolicy', 'no-referrer');
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: 'application/pdf' }));
  fireEvent.click(screen.getByRole('button', { name: 'Tải PDF nếu không xem được' }));
  await waitFor(() => expect(clicked).toHaveLength(1));
  expect(clicked[0].filename).toBe('bien-ban.pdf');
  expect(fetchBlob).toHaveBeenCalledTimes(2);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đóng' }));
  expect(revoke).toHaveBeenCalledWith('blob:private-1');
  expect(revoke).toHaveBeenCalledWith(clicked[0].url);
});

it('keeps short PDF buttons in the compact handover view with the same private preview and download actions', async () => {
  const fetchBlob = vi.fn(async () => makeBlob(pdf, 'application/pdf'));
  render(
    <PrivateEvidenceViewer
      label="PDF bản nháp bàn giao (chưa xác nhận)"
      filename="handover.pdf"
      compactActions
      fetchBlob={fetchBlob}
    />,
  );
  expect(screen.queryByRole('button', { name: /Xem PDF bản nháp/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Xem PDF' }));
  expect(
    await screen.findByTitle('Nội dung PDF: PDF bản nháp bàn giao (chưa xác nhận)'),
  ).toHaveAttribute('src', 'blob:private-1');
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đóng' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Tải xuống' }));
  await waitFor(() => expect(clicked).toHaveLength(1));
  expect(clicked[0].filename).toBe('handover.pdf');
  expect(fetchBlob).toHaveBeenCalledTimes(2);
});

it('uses a specific confirmed-handover preview label with compact icon download', async () => {
  const fetchBlob = vi.fn(async () => makeBlob(pdf, 'application/pdf'));
  render(
    <PrivateEvidenceViewer
      label="PDF bàn giao đã xác nhận"
      previewButtonLabel="Xem biên bản bàn giao đã xác nhận"
      filename="bien-ban-ban-giao-chinh-thuc.pdf"
      compactActions
      fetchBlob={fetchBlob}
    />,
  );
  expect(screen.queryByRole('button', { name: 'Xem PDF' })).toBeNull();
  const download = screen.getByRole('button', { name: 'Tải xuống' });
  expect(download.querySelector('svg.lucide-download')).not.toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Xem biên bản bàn giao đã xác nhận' }));
  expect(await screen.findByTitle('Nội dung PDF: PDF bàn giao đã xác nhận')).toBeInTheDocument();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đóng' }));
  fireEvent.click(download);
  await waitFor(() => expect(clicked[0]?.filename).toBe('bien-ban-ban-giao-chinh-thuc.pdf'));
});

it('downloads verified JPEG with a sanitized name and releases the object URL on unmount', async () => {
  const fetchBlob = vi.fn(async () => makeBlob(jpeg, 'image/jpeg'));
  const result = render(
    <PrivateEvidenceViewer label="ảnh" filename="../../unsafe.html" fetchBlob={fetchBlob} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Tải xuống ảnh' }));
  await waitFor(() => expect(clicked).toHaveLength(1));
  expect(clicked[0].filename).toBe('unsafe.jpg');
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ type: 'image/jpeg' }));
  result.unmount();
  expect(revoke).toHaveBeenCalledWith(clicked[0].url);
});

it('never embeds HTML/SVG or mismatched content and falls back to passive binary download', async () => {
  const fetchBlob = vi.fn(
    async () => new Blob(['<svg onload="alert(1)"/>'], { type: 'image/svg+xml' }),
  );
  render(<PrivateEvidenceViewer label="tệp" filename="evidence.svg" fetchBlob={fetchBlob} />);
  fireEvent.click(screen.getByRole('button', { name: 'Xem tệp' }));
  const dialog = screen.getByRole('dialog', { name: 'Xem tệp' });
  expect(await within(dialog).findByText(/không hỗ trợ xem trực tiếp/i)).toBeInTheDocument();
  expect(within(dialog).queryByRole('img')).toBeNull();
  expect(within(dialog).queryByTitle(/PDF:/)).toBeNull();
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Tải xuống' }));
  await waitFor(() => expect(clicked).toHaveLength(1));
  expect(clicked[0].filename).toBe('evidence.bin');
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'application/octet-stream' }),
  );
  fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
  expect(revoke).toHaveBeenCalledWith(clicked[0].url);
});

it('rejects metadata/magic mismatches and wrong size without enabling inline preview', async () => {
  const fetchBlob = vi.fn(async () => makeBlob(jpeg, 'image/jpeg'));
  const result = render(
    <PrivateEvidenceViewer
      label="chứng từ"
      filename="file.png"
      contentType="image/png"
      fetchBlob={fetchBlob}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xem chứng từ' }));
  expect(await screen.findByText(/không hỗ trợ xem trực tiếp/i)).toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
  result.unmount();

  render(
    <PrivateEvidenceViewer
      label="kiểm tra"
      filename="file.png"
      expectedSize={1000}
      fetchBlob={async () => makeBlob(png, 'image/png')}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xem kiểm tra' }));
  expect(await screen.findByText(/Kích thước chứng từ không khớp/)).toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
});

it('shows an authenticated-denial error, retries, and never creates a URL on failure', async () => {
  const fetchBlob = vi
    .fn<(_: AbortSignal) => Promise<Blob>>()
    .mockRejectedValueOnce({ status: 403 })
    .mockResolvedValueOnce(makeBlob(png, 'image/png'));
  render(
    <PrivateEvidenceViewer
      label="riêng tư"
      filename="private"
      fetchBlob={fetchBlob}
      errorMessage={() => 'Không có quyền truy cập chứng từ'}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xem riêng tư' }));
  expect(await screen.findByText('Không có quyền truy cập chứng từ')).toBeInTheDocument();
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByRole('img', { name: 'riêng tư' })).toBeInTheDocument();
  expect(fetchBlob).toHaveBeenCalledTimes(2);
});

it('preserves real ApiError.problem.correlationId on HTTP 500 for both preview and download', async () => {
  const correlationId = '123e4567-e89b-12d3-a456-426614174000';
  const apiError = new ApiError(500, { code: 'internal_error', correlationId });
  const fetchBlob = vi.fn(async (): Promise<Blob> => {
    throw apiError;
  });
  render(
    <PrivateEvidenceViewer
      label="ảnh lỗi"
      filename="anh-loi.jpg"
      fetchBlob={fetchBlob}
      errorMessage={() => 'Máy chủ gặp lỗi xử lý. · HTTP 500'}
    />,
  );

  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh lỗi' }));
  const previewError = await within(screen.getByRole('dialog')).findByText(/Máy chủ gặp lỗi xử lý/);
  expect(previewError).toHaveTextContent('HTTP 500');
  expect(previewError).toHaveTextContent(`Mã truy vết: ${correlationId}`);
  expect(previewError.textContent?.match(/Mã truy vết:/g)).toHaveLength(1);
  expect(create).not.toHaveBeenCalled();

  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đóng' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Tải xuống ảnh lỗi' }));
  const downloadError = await screen.findByText(/Máy chủ gặp lỗi xử lý/);
  expect(downloadError).toHaveTextContent(`Mã truy vết: ${correlationId}`);
  expect(downloadError.textContent?.match(/Mã truy vết:/g)).toHaveLength(1);
  expect(fetchBlob).toHaveBeenCalledTimes(2);
  expect(create).not.toHaveBeenCalled();
});

it('uses real ApiError.problem.code and correlationId for missing evidence without leaking unsafe details', async () => {
  const correlationId = '123e4567-e89b-12d3-a456-426614174000';
  const fetchBlob = vi.fn(async (): Promise<Blob> => {
    throw new ApiError(404, {
      code: 'private_evidence_file_missing',
      correlationId,
      detail: 'objectKey=private/tenant/hidden-key',
    });
  });
  render(
    <PrivateEvidenceViewer
      label="ảnh thất lạc"
      filename="anh.jpg"
      fetchBlob={fetchBlob}
      errorMessage={() => '404 chung'}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh thất lạc' }));
  const message = await screen.findByText(
    /Tệp bằng chứng đã được ghi nhận nhưng không còn trong kho lưu trữ/,
  );
  expect(message).toHaveTextContent('HTTP 404');
  expect(message).toHaveTextContent(`Mã truy vết: ${correlationId}`);
  expect(message).not.toHaveTextContent('private/tenant/hidden-key');
  expect(create).not.toHaveBeenCalled();
});

it('does not render invalid nested trace IDs supplied by API errors', async () => {
  render(
    <PrivateEvidenceViewer
      label="ảnh nhạy cảm"
      filename="anh.jpg"
      fetchBlob={async () => {
        throw new ApiError(500, { correlationId: 'object-key/secret?token=123' });
      }}
      errorMessage={() => 'Lỗi HTTP 500'}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh nhạy cảm' }));
  const error = await screen.findByText('Lỗi HTTP 500');
  expect(error).not.toHaveTextContent('object-key');
  expect(error).not.toHaveTextContent('Mã truy vết');
});

it('identifies evidence HTTP 503 without incorrectly blaming the signing service', async () => {
  const backendFailure = Object.assign(new Error('Provider unavailable'), {
    status: 503,
    requestPath: '/api/v1/contracts/contract/evidence/file',
    method: 'GET',
    correlationId: '123e4567-e89b-12d3-a456-426614174000',
  });
  const fetchBlob = vi.fn(async (): Promise<Blob> => {
    throw backendFailure;
  });
  render(
    <PrivateEvidenceViewer
      label="ảnh biên bản"
      filename="bien-ban.jpg"
      fetchBlob={fetchBlob}
      errorMessage={() =>
        'Dịch vụ ký hoặc thành phần xử lý chưa sẵn sàng. Hãy kiểm tra trạng thái trước khi thử lại.'
      }
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh biên bản' }));
  const dialog = screen.getByRole('dialog', { name: 'Xem ảnh biên bản' });
  const error = await within(dialog).findByText(
    /Máy chủ tạm thời chưa cung cấp được tệp bằng chứng/,
  );
  expect(error).toHaveTextContent('HTTP 503');
  expect(error).toHaveTextContent('Mã truy vết: 123e4567-e89b-12d3-a456-426614174000');
  expect(error).not.toHaveTextContent('Dịch vụ ký');
  expect(create).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Tải xuống ảnh biên bản' }));
  const downloadError = await screen.findByText(
    /Máy chủ tạm thời chưa cung cấp được tệp bằng chứng/,
  );
  expect(downloadError).toHaveTextContent('HTTP 503');
  expect(downloadError).not.toHaveTextContent('Dịch vụ ký');
  expect(create).not.toHaveBeenCalled();
  expect(fetchBlob).toHaveBeenCalledTimes(2);
});

it.each([
  ['problem.code', { status: 404, problem: { code: 'private_evidence_file_missing' } }],
  ['direct code', { status: 404, code: 'private_evidence_file_missing' }],
])(
  'explains missing private object with %s without exposing storage keys',
  async (_variant, problem) => {
    const fetchBlob = vi.fn(async (): Promise<Blob> => {
      throw {
        ...problem,
        requestPath: '/api/v1/contracts/example/evidence/missing',
        method: 'GET',
        correlationId: '123e4567-e89b-12d3-a456-426614174000',
        objectKey: 'private/storage/do-not-disclose',
      };
    });
    render(
      <PrivateEvidenceViewer
        label="ảnh cũ"
        filename="anh-cu.jpg"
        fetchBlob={fetchBlob}
        errorMessage={() => 'Không tìm thấy tài nguyên.'}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh cũ' }));
    const dialog = screen.getByRole('dialog', { name: 'Xem ảnh cũ' });
    const message = await within(dialog).findByText(
      /Tệp bằng chứng đã được ghi nhận nhưng không còn trong kho lưu trữ/,
    );
    expect(message).toHaveTextContent(
      'Cần khôi phục tệp gốc hoặc tải lại bằng chứng, không thể tải/xem từ metadata.',
    );
    expect(message).toHaveTextContent('HTTP 404');
    expect(message).toHaveTextContent('Mã truy vết: 123e4567-e89b-12d3-a456-426614174000');
    expect(message).not.toHaveTextContent('private/storage/do-not-disclose');
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Đóng' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Tải xuống ảnh cũ' }));
    expect(
      await screen.findByText(/Tệp bằng chứng đã được ghi nhận nhưng không còn trong kho lưu trữ/),
    ).toHaveTextContent('HTTP 404');
    expect(create).not.toHaveBeenCalled();
    expect(fetchBlob).toHaveBeenCalledTimes(2);
  },
);

it('keeps unrelated HTTP 404 evidence errors mapped by the consumer', async () => {
  render(
    <PrivateEvidenceViewer
      label="ảnh"
      filename="anh.jpg"
      fetchBlob={async () => {
        throw { status: 404, problem: { code: 'unrelated_missing_resource' } };
      }}
      errorMessage={() => 'Không tìm thấy tài nguyên trong phạm vi được phép.'}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Xem ảnh' }));
  expect(
    await screen.findByText('Không tìm thấy tài nguyên trong phạm vi được phép.'),
  ).toBeInTheDocument();
  expect(screen.queryByText(/Tệp bằng chứng đã được ghi nhận/)).toBeNull();
});

it('locks concurrent actions and ignores an in-flight response after dialog close', async () => {
  let finish!: (blob: Blob) => void;
  let receivedSignal!: AbortSignal;
  const fetchBlob = vi.fn(
    (signal: AbortSignal) =>
      new Promise<Blob>((resolve) => {
        receivedSignal = signal;
        finish = resolve;
      }),
  );
  render(<PrivateEvidenceViewer label="chứng từ" filename="file" fetchBlob={fetchBlob} />);
  fireEvent.click(screen.getByRole('button', { name: 'Xem chứng từ' }));
  // MUI Dialog hides background controls from the accessibility tree; the
  // underlying disabled control remains in the DOM and still must not fetch.
  const download = screen.getByText('Tải xuống chứng từ').closest('button')!;
  expect(download).toBeDisabled();
  fireEvent.click(download);
  expect(fetchBlob).toHaveBeenCalledTimes(1);
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Đóng' }));
  expect(receivedSignal.aborted).toBe(true);
  await act(async () => finish(makeBlob(png, 'image/png')));
  expect(create).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
