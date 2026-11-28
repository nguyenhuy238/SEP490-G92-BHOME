// A deliberately labeled synthetic JPEG for locally testing the meter flow.
// This is not evidence of a real reading; it must never be offered on native or production.
export function canUseLocalMeterDemo(
  development: boolean,
  platform: string,
  hostname: string | undefined,
  port: string | undefined,
): boolean {
  return (
    development &&
    platform === 'web' &&
    (hostname === 'localhost' || hostname === '127.0.0.1') &&
    port === '8081'
  );
}

export function createMeterDemoJpeg(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas unavailable.');
  context.fillStyle = '#f3f5f8';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#9f2424';
  context.font = 'bold 36px sans-serif';
  context.fillText('BHOME - DEV TEST', 36, 118);
  context.font = 'bold 24px sans-serif';
  context.fillText('ANH GIA - KHONG PHAI CONG TO', 36, 188);
  context.font = '20px sans-serif';
  context.fillText('Chi dung thu luong upload / nhap chi so / xac nhan', 36, 245);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  // The API accepts JPEG evidence. Never send a PNG or an empty Canvas fallback
  // under the image/jpeg Content-Type.
  const bytes = meterDemoJpegBytes(dataUrl);
  if (bytes.length < 100) throw new Error('Invalid test image.');
  bytes.fill(0);
  return dataUrl;
}

export function meterDemoJpegBytes(dataUrl: string): Uint8Array<ArrayBuffer> {
  if (!dataUrl.startsWith('data:image/jpeg;base64,')) throw new Error('Invalid test image format.');
  const encoded = dataUrl.slice('data:image/jpeg;base64,'.length);
  const raw = atob(encoded);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index);
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
    throw new Error('Invalid test JPEG.');
  return bytes;
}
