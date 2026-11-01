import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: 'web',
  cache: vi.fn(() => ({ uri: 'file:///synthetic-cache/' })),
  directory: vi.fn(),
  deleted: vi.fn(),
}));
vi.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mocks.platform;
    },
  },
}));
vi.mock('expo-file-system', () => ({
  Directory: class {
    constructor(...args: unknown[]) {
      mocks.directory(...args);
    }
    exists = true;
    delete = mocks.deleted;
  },
  File: vi.fn(),
  Paths: {
    get cache() {
      return mocks.cache();
    },
  },
}));
import { clearAbandonedCaptures } from '../../../src/mobile/src/lib/captureFiles';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cache.mockImplementation(() => ({ uri: 'file:///synthetic-cache/' }));
});

describe('temporary capture cleanup by platform', () => {
  it('does not access the unsupported file system on web during session startup', () => {
    mocks.platform = 'web';
    mocks.cache.mockImplementation(() => {
      throw new TypeError('this.validatePath is not a function');
    });
    expect(() => clearAbandonedCaptures()).not.toThrow();
    expect(mocks.cache).not.toHaveBeenCalled();
    expect(mocks.directory).not.toHaveBeenCalled();
    expect(mocks.deleted).not.toHaveBeenCalled();
  });

  it.each(['ios', 'android'])(
    'still deletes only app-owned temporary directories on %s',
    (platform) => {
      mocks.platform = platform;
      clearAbandonedCaptures();
      expect(mocks.directory.mock.calls).toEqual([
        [{ uri: 'file:///synthetic-cache/' }, 'bhome-ocr'],
        [{ uri: 'file:///synthetic-cache/' }, 'ImageManipulator'],
        [{ uri: 'file:///synthetic-cache/' }, 'bhome-contract-downloads'],
      ]);
      expect(mocks.deleted).toHaveBeenCalledTimes(3);
    },
  );
});
