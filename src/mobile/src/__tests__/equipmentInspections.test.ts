import { expect, it, vi } from 'vitest';
import { equipmentInspectionClient } from '../../../../packages/client-core/src/equipmentInspections';

it('submits a batch with the server version and propagates a rejected write', async () => {
  const request = vi.fn().mockRejectedValue({ status: 409 });
  const service = equipmentInspectionClient(request);
  const answers = [
    {
      unitId: 'unit',
      checklistCode: 'position',
      result: 'Failed',
      note: 'Synthetic',
      evidenceIds: ['evidence'],
    },
  ];
  await expect(service.save('inspection', 3, answers, true)).rejects.toEqual({ status: 409 });
  expect(request).toHaveBeenCalledExactlyOnceWith(
    '/api/v1/equipment-inspections/inspection/answers',
    {
      method: 'PUT',
      body: JSON.stringify({ expectedVersion: 3, answers, submit: true }),
    },
  );
});
