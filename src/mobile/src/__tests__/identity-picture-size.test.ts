import { expect, it } from 'vitest';
import { identityPictureSize } from '../lib/identityPictureSize';

it('chooses the largest device photo within 12 MP independently of order', () => {
  expect(identityPictureSize(['1920x1080', '8000x6000', '4000x3000', 'invalid'])).toBe('4000x3000');
  expect(identityPictureSize(['4000x3000', '1920x1080'])).toBe('4000x3000');
});
it('uses the smallest oversized option when the device exposes no bounded photo', () => {
  expect(identityPictureSize(['8000x6000', '4032x3024'])).toBe('4032x3024');
  expect(identityPictureSize(['invalid', '0x100'])).toBeUndefined();
});
it('preserves near-12 MP camera detail when the alternative is much smaller', () => {
  expect(identityPictureSize(['1920x1080', '8000x6000', '4032x3024'])).toBe('4032x3024');
  expect(identityPictureSize(['3840x2160', '8000x6000'])).toBe('3840x2160');
  expect(identityPictureSize(['4000x3000', '4032x3024'])).toBe('4000x3000');
});
