import { vi } from 'vitest';

// Node has no Expo native runtime. Match Expo Core's UUID API for component tests.
// Production continues to use the actual native uuid.v4 implementation.
vi.mock('expo', async () => {
  const { randomUUID } = await import('node:crypto');
  return { uuid: { v4: randomUUID } };
});
