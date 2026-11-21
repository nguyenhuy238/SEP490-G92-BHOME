import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  clearToasts,
  conciseMessage,
  dismissToast,
  finishToast,
  getToastSnapshot,
  registerToastHost,
  showError,
  showInfo,
  showSuccess,
  showToast,
  showWarning,
  type ToastType,
} from '../lib/toast';
beforeEach(() => {
  vi.useFakeTimers();
  clearToasts();
});
afterEach(() => {
  clearToasts();
  vi.useRealTimers();
});

it.each<[ToastType, number]>([
  ['success', 3000],
  ['error', 5000],
  ['warning', 4000],
  ['info', 3000],
])('expires %s after its own duration and allows its exit animation', (type, duration) => {
  showToast(type, 'Thông báo kiểm thử');
  vi.advanceTimersByTime(duration - 1);
  expect(getToastSnapshot().toast?.closing).toBe(false);
  vi.advanceTimersByTime(1);
  expect(getToastSnapshot().toast?.closing).toBe(true);
  vi.advanceTimersByTime(200);
  expect(getToastSnapshot().toast).toBeNull();
});
it('deduplicates active messages without extending their lifetime and replaces rather than stacking', () => {
  showSuccess('Đã lưu.');
  const id = getToastSnapshot().toast!.id;
  vi.advanceTimersByTime(2000);
  showSuccess('Đã lưu.');
  expect(getToastSnapshot().toast!.id).toBe(id);
  vi.advanceTimersByTime(1200);
  expect(getToastSnapshot().toast).toBeNull();
  showError('Không thể lưu.');
  showWarning('Kiểm tra ngày cấp.');
  expect(getToastSnapshot().toast?.type).toBe('warning');
  showInfo('Thông báo mới', 'Tiêu đề tùy chọn');
  expect(getToastSnapshot().toast?.title).toBe('Tiêu đề tùy chọn');
});
it('dismisses manually and prevents an old animation/timer from removing a new message', () => {
  showError('Lỗi trước');
  const old = getToastSnapshot().toast!.id;
  dismissToast();
  showSuccess('Lưu lại thành công');
  finishToast(old);
  vi.advanceTimersByTime(200);
  expect(getToastSnapshot().toast?.type).toBe('success');
  clearToasts();
  expect(vi.getTimerCount()).toBe(0);
});
it('uses the topmost modal host and transfers the same message back without replaying the timer', () => {
  const root = registerToastHost('root', false);
  const modal = registerToastHost('modal', true);
  try {
    showInfo('Thông tin');
    const id = getToastSnapshot().toast!.id;
    expect(getToastSnapshot().host).toBe('modal');
    vi.advanceTimersByTime(2000);
    modal();
    expect(getToastSnapshot().host).toBe('root');
    expect(getToastSnapshot().toast!.id).toBe(id);
    vi.advanceTimersByTime(1200);
    expect(getToastSnapshot().toast).toBeNull();
  } finally {
    modal();
    root();
  }
});
it('keeps ordinary errors short and excludes request paths and trace identifiers', () => {
  expect(
    conciseMessage(
      'Dữ liệu chưa hợp lệ. · POST /api/v1/capture/residents/id/confirm · HTTP 400 · Mã truy vết: trace',
    ),
  ).toBe('Dữ liệu chưa hợp lệ.');
  expect(
    conciseMessage(
      'Kết nối tới máy chủ đang gián đoạn. Hãy thử lại. API nội bộ cần cùng mạng và chứng chỉ tin cậy.',
    ),
  ).toBe('Kết nối tới máy chủ đang gián đoạn. Hãy thử lại.');
  expect(conciseMessage('Cannot convert BigInt to number')).toBe(
    'Không thể hoàn tất. Vui lòng thử lại.',
  );
  expect(conciseMessage('contract_unknown_error')).toBe('Không thể hoàn tất. Vui lòng thử lại.');
  expect(conciseMessage('Nội dung '.repeat(100)).length).toBeLessThan(260);
});
