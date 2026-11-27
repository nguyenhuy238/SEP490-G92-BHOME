import { expect, it } from 'vitest';
import { UserFeedbackError } from '../../../../packages/client-core/src/api';
import {
  contractError,
  dateOnly,
  required,
  vnd,
} from '../../../../packages/client-core/src/contracts';
import { handoverQuantity } from '../../../../packages/client-core/src/handoverForm';

it.each([
  [() => dateOnly('31/02/2030'), 'Ngày không hợp lệ. Nhập dd/MM/yyyy.'],
  [() => required('', 200), 'Nội dung bắt buộc, tối đa 200 ký tự.'],
  [() => vnd('-1'), 'Nhập số nguyên VND hợp lệ, tối đa 18 chữ số.'],
  [() => handoverQuantity('1.5', 'Số lượng'), 'Số lượng: nhập số nguyên từ 0 đến 10.000.'],
] as const)(
  'preserves intentional validation while distinguishing runtime errors',
  (validate, message) => {
    let failure: unknown;
    try {
      validate();
    } catch (cause) {
      failure = cause;
    }
    expect(failure).toBeInstanceOf(UserFeedbackError);
    expect(contractError(failure)).toBe(message);
  },
);

it('does not treat a native/provider Error as approved validation text', () => {
  expect(contractError(new Error('IOException token=secret /private/cache'))).not.toMatch(
    /secret|IOException|cache/,
  );
});

it('explains a move-out roster blocked by the current business date instead of a generic conflict', () => {
  expect(contractError({ status: 409, code: 'move_out_residence_not_started' })).toContain(
    'Demo Clock',
  );
  expect(contractError({ status: 409, code: 'move_out_roster_unavailable' })).toContain(
    'thành viên đang cư trú',
  );
});
