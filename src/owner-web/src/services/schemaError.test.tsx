import { expect, it } from 'vitest';
import { ApiError } from '../../../../packages/client-core/src/api';
import { contractError } from '../../../../packages/client-core/src/contracts';
import { paymentError } from '../../../../packages/client-core/src/payments';
import { adjustmentError } from '../../../../packages/client-core/src/adjustments';
import { financeError } from '../../../../packages/client-core/src/finance';
import { ownerError } from '../hooks/useOwnerWorkspace';

it('explains incompatible server schema consistently across the affected Owner workspaces', () => {
  const problem = new ApiError(503, { code: 'database_schema_incompatible', status: 503 });
  for (const format of [contractError, paymentError, adjustmentError, financeError, ownerError]) {
    const message = format(problem);
    expect(message).toContain('Máy chủ và cơ sở dữ liệu chưa đồng bộ');
    expect(message).toContain('quản trị viên');
    expect(message).not.toContain('42703');
  }
});

it('preserves permission refusals and does not classify arbitrary failures as schema drift', () => {
  for (const format of [contractError, paymentError, adjustmentError, financeError, ownerError]) {
    expect(format(new ApiError(403))).not.toContain('chưa đồng bộ');
    expect(format(new ApiError(500))).not.toContain('chưa đồng bộ');
  }
});
