import { describe, expect, it } from 'vitest';
import type { MoveOut, SettlementSummary } from '../../../../../packages/client-core/src/contracts';
import {
  financialState,
  historyNote,
  moveOutProgress,
  offsetAmountError,
} from './components/settlement/termination';
import { moveOutActionLabel } from '../../../../../packages/client-core/src/useContractLifecycle';

describe('move-out status and settlement remain independent', () => {
  it('shows the Owner-created location task clearly in move-out history', () => {
    expect(moveOutActionLabel('OwnerMoveOutOpened')).toBe('Owner lập yêu cầu trả phòng');
  });
  const completed = { status: 'Completed', financialReviewStatus: 'PendingReview' } as MoveOut;
  it('does not claim that physical closure paid the debt', () => {
    const progress = moveOutProgress(completed, true, false);
    expect(progress.find((step) => step.label === 'Trả phòng')?.done).toBe(true);
    expect(progress.find((step) => step.label === 'Mở nhiệm vụ trả phòng')?.done).toBe(true);
    expect(progress.find((step) => step.label === 'Quyết toán')?.done).toBe(false);
    expect(financialState(null, completed)).toBe('Chưa đối chiếu được');
    expect(financialState({ resolved: false } as SettlementSummary, completed)).toBe(
      'Chưa hoàn tất',
    );
    expect(financialState({ resolved: true } as SettlementSummary, completed)).toBe(
      'Chờ Owner xác nhận',
    );
  });
  it('requires resolved sources and an Owner review before financial completion', () => {
    const reviewed = { ...completed, financialReviewStatus: 'OwnerReviewed' } as MoveOut;
    expect(moveOutProgress(reviewed, true, true).every((step) => step.done)).toBe(true);
    expect(financialState({ resolved: true } as SettlementSummary, reviewed)).toBe('Đã hoàn tất');
  });
});

it('validates offset bounds exactly beyond JavaScript safe integer and keeps unknown amounts unknown', () => {
  expect(offsetAmountError('9007199254740993', '9007199254740992', '99999999999999999')).toBe(
    'Số tiền vượt cọc khả dụng.',
  );
  expect(
    offsetAmountError('9007199254740992', '9007199254740993.00', '9007199254740992'),
  ).toBeNull();
  expect(offsetAmountError('100', '1000', '99')).toBe('Số tiền vượt nghĩa vụ còn phải thanh toán.');
  expect(offsetAmountError('100', '1000', null)).toBeTruthy();
  expect(offsetAmountError('100', 'unknown', '100')).toBeTruthy();
  for (const value of ['0', '-1', '1.2', '1e3', '9999999999999999999'])
    expect(offsetAmountError(value, '1000', '1000')).toBeTruthy();
});

it('renders only allowlisted history notes from JSON strings without exposing storage or financial keys', () => {
  for (const value of [
    '{bad',
    'null',
    '[]',
    '{"reference":"secret","actorId":"internal"}',
    { reason: 'not a JSON string' },
  ])
    expect(historyNote(value)).toBeNull();
  expect(historyNote('{"Reason":"Kiểm tra lại tài sản","reference":"hidden"}')).toBe(
    'Kiểm tra lại tài sản',
  );
  expect(historyNote('{"inspectionNotes":"Đã nhận chìa khóa"}')).toBe('Đã nhận chìa khóa');
});
