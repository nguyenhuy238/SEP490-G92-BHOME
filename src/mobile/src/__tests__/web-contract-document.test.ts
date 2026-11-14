// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { deliverWebDocument, openPdfWindow } from '../features/contracts/webContractDocument';
const bytes = () => new TextEncoder().encode('%PDF-1.7\nsynthetic-test-only');
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
it('opens a reserved reader with authenticated bytes, without a download or token URL, and revokes only after close', async () => {
  vi.useFakeTimers();
  const replace = vi.fn(),
    tab = { opener: {}, closed: false, location: { replace } };
  vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:private-pdf');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  expect(openPdfWindow()).toBe(tab);
  expect(tab.opener).toBeNull();
  deliverWebDocument(bytes(), true, 'hop-dong-101.pdf', tab as unknown as Window);
  expect((create.mock.calls[0]![0] as Blob).type).toBe('application/pdf');
  expect(replace).toHaveBeenCalledWith('blob:private-pdf');
  expect(revoke).not.toHaveBeenCalled();
  tab.closed = true;
  await vi.advanceTimersByTimeAsync(1000);
  expect(revoke).toHaveBeenCalledWith('blob:private-pdf');
});
it('downloads a valid PDF with a filename and revokes the temporary Blob', async () => {
  vi.useFakeTimers();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    expect(this.download).toBe('hop-dong-101.pdf');
    expect(this.href).toBe('blob:download');
  });
  deliverWebDocument(bytes(), true, 'hop-dong-101.pdf');
  expect(click).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(revoke).toHaveBeenCalledWith('blob:download');
});
it('rejects invalid bytes and reports a blocked popup before any request', () => {
  vi.spyOn(window, 'open').mockReturnValue(null);
  expect(() => openPdfWindow()).toThrow('pdf_popup_blocked');
  expect(() =>
    deliverWebDocument(new TextEncoder().encode('<html>error</html>'), true, 'bad.pdf'),
  ).toThrow('draft_download_invalid');
});
