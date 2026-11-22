// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
const feedback = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock('../lib/toast', async (original) => ({
  ...(await original<typeof import('../lib/toast')>()),
  showToast: feedback.show,
}));
import { useFeedbackState } from '../lib/useFeedbackState';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('announces an unchanged error once until the user clears it or gets a different result', () => {
  const { result } = renderHook(() => useFeedbackState());
  act(() => result.current[1]('Không lưu được. Hãy thử lại.'));
  act(() => result.current[1]((current) => current));
  expect(feedback.show).toHaveBeenCalledTimes(1);
  act(() => result.current[1](''));
  expect(feedback.show).toHaveBeenCalledTimes(1);
  act(() => result.current[1]('Không lưu được. Hãy thử lại.'));
  expect(feedback.show).toHaveBeenCalledTimes(2);
});

it('keeps inline-only feedback and removes technical diagnostics from the displayed message', () => {
  const { result } = renderHook(() => useFeedbackState('warning', false));
  act(() => result.current[1]('Dữ liệu đã thay đổi. · POST /api/v1/contracts/private · HTTP 409'));
  expect(result.current[0]).toBe('Dữ liệu đã thay đổi.');
  expect(feedback.show).not.toHaveBeenCalled();
});
