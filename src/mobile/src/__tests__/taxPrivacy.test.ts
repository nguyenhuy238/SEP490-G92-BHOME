import { expect, it, vi } from 'vitest';
import { taxPrivacyClient } from '../../../../packages/client-core/src/taxPrivacy';

it('keeps user and request identifiers together and sends the current decision version', async () => {
  const request = vi.fn().mockResolvedValue({});
  await taxPrivacyClient(request).decideRequest(
    { id: 'request', requestedBy: 'tenant', version: 3 } as Parameters<
      ReturnType<typeof taxPrivacyClient>['decideRequest']
    >[0],
    'InReview',
    'Synthetic response',
    'Synthetic basis',
  );
  expect(request).toHaveBeenCalledExactlyOnceWith(
    '/api/v1/personal-data-requests/tenant/request/decisions',
    {
      method: 'POST',
      body: JSON.stringify({
        expectedVersion: 3,
        status: 'InReview',
        resolution: 'Synthetic response',
        basis: 'Synthetic basis',
      }),
    },
  );
});
