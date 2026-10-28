// Only offer physical lenses reported by this device. Ultra-wide presence does not prove macro autofocus.
const lensLabels = [
  ['AVCaptureDeviceTypeBuiltInWideAngleCamera', 'Camera chính'],
  ['AVCaptureDeviceTypeBuiltInUltraWideCamera', 'Siêu rộng · thử chụp gần'],
] as const;

export function captureLensOptions(reported: unknown): { id: string; label: string }[] {
  const available = new Set(
    (Array.isArray(reported) ? reported : []).flatMap((lens: unknown) =>
      lens &&
      typeof lens === 'object' &&
      'deviceType' in lens &&
      typeof lens.deviceType === 'string'
        ? [lens.deviceType]
        : [],
    ),
  );
  return lensLabels.filter(([id]) => available.has(id)).map(([id, label]) => ({ id, label }));
}
