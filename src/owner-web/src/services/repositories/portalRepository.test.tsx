import { afterEach, expect, it, vi } from 'vitest';
import { createPortalRepository } from './portalRepository';
const mock = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('./mockPortalRepository', () => ({ createMockRepository: mock.create }));
afterEach(() => vi.resetAllMocks());
it('never initializes demo storage and rejects unsupported operations in API mode', async () => {
  const repository = createPortalRepository(false);
  expect(mock.create).not.toHaveBeenCalled();
  await expect(repository.read()).rejects.toThrow('Dữ liệu demo không được sử dụng');
  await expect(repository.reset()).rejects.toThrow('Dữ liệu demo không được sử dụng');
});
it('keeps the demo repository available only through explicit mock mode', () => {
  const repository = { read: vi.fn() };
  mock.create.mockReturnValue(repository);
  expect(createPortalRepository(true)).toBe(repository);
  expect(mock.create).toHaveBeenCalledTimes(1);
});
