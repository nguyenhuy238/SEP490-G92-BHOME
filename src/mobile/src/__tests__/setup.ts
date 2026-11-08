import { afterEach, vi } from 'vitest';
import { clearToasts } from '../lib/toast';

// Existing screen mocks do not include native animation/keyboard APIs. Dedicated
// ToastHost and keyboard tests unmock these components and verify their real behavior.
vi.mock('../components/ToastHost', () => ({ ToastHost: () => null }));
vi.mock('../components/KeyboardFormScrollView', async () => {
  const native = await import('react-native');
  return { KeyboardFormScrollView: native.ScrollView };
});
afterEach(clearToasts);

// Node has no Expo native runtime. Match Expo Core's UUID API for component tests.
// Production continues to use the actual native uuid.v4 implementation.
vi.mock('expo', async () => {
  const { randomUUID } = await import('node:crypto');
  return { uuid: { v4: randomUUID } };
});
