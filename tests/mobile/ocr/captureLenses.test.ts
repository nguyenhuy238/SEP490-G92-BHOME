import { describe, expect, it } from 'vitest';
import { captureLensOptions } from '../../../src/mobile/src/lib/captureLenses';

describe('camera lens capability fallback', () => {
  it('does not assume any model has an ultra-wide or macro camera', () => {
    expect(captureLensOptions(undefined)).toEqual([]);
    expect(captureLensOptions([])).toEqual([]);
    const options = captureLensOptions([
      { deviceType: 'AVCaptureDeviceTypeBuiltInWideAngleCamera', localizedName: 'Back Camera' },
    ]);
    expect(options.map((option) => option.id)).toEqual([
      'AVCaptureDeviceTypeBuiltInWideAngleCamera',
    ]);
  });
  it('offers only discovered physical lenses and deduplicates discovery events', () => {
    const options = captureLensOptions([
      { deviceType: 'AVCaptureDeviceTypeBuiltInTripleCamera' },
      { deviceType: 'AVCaptureDeviceTypeBuiltInUltraWideCamera' },
      { deviceType: 'AVCaptureDeviceTypeBuiltInWideAngleCamera' },
      { deviceType: 'AVCaptureDeviceTypeBuiltInUltraWideCamera' },
    ]);
    expect(options).toHaveLength(2);
    expect(options[1]?.id).toBe('AVCaptureDeviceTypeBuiltInUltraWideCamera');
    expect(options[1]?.label).not.toContain('macro');
  });
  it('falls back without crashing on unsupported or legacy discovery payloads', () => {
    expect(captureLensOptions([null, 'Back Camera', {}, { deviceType: 123 }])).toEqual([]);
    expect(captureLensOptions({ lenses: [] })).toEqual([]);
  });
});
