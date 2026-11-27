import type { PictureRef } from 'expo-camera';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { ownCapture } from './captureFiles';

// OcrController/OcrDiagnosticsController request limits, OcrOptions.MaxPixels,
// and CaptureRepository.SaveEvidenceAsync use these bounds in the current API.
export const captureMaxBytes = 5 * 1024 * 1024;
export const captureMaxPixels = 12_000_000;
// Identity preprocessing on the server uses this same maximum edge.
export const identityCaptureMaxDimension = 1600;

export async function prepareCapture(
  picture: PictureRef,
  current: () => boolean,
  purpose: 'ocr' | 'identity' | 'evidence' = 'ocr',
): Promise<string> {
  const { width, height } = picture;
  if (!Number.isFinite(width * height) || width <= 0 || height <= 0)
    throw new Error('Invalid capture dimensions.');
  const context = ImageManipulator.manipulate(picture);
  const evidence = purpose === 'evidence';
  // Avoid uploading a multi-megabyte identity photo that the server immediately
  // downsizes. Upload time otherwise consumes the bounded OCR request deadline.
  let scale =
    evidence || purpose === 'identity'
      ? Math.min(1, identityCaptureMaxDimension / Math.max(width, height))
      : Math.min(1, Math.sqrt(captureMaxPixels / (width * height)));
  try {
    // Bounded retries re-encode from the native source, never from a compressed JPEG.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!current()) throw new Error('Capture session ended.');
      context.reset();
      if (scale < 1)
        context.resize({
          width: Math.max(1, Math.floor(width * scale)),
          height: Math.max(1, Math.floor(height * scale)),
        });
      const image = await context.renderAsync();
      let uri = '';
      try {
        const output = await image.saveAsync({
          format: SaveFormat.JPEG,
          compress: evidence ? 0.85 : 0.95,
        });
        uri = output.uri;
        const file = new File(uri);
        if (current() && file.size > 0 && file.size <= captureMaxBytes) {
          const owned = ownCapture(uri);
          uri = '';
          return owned;
        }
        scale *= Math.min(0.85, Math.sqrt(captureMaxBytes / Math.max(1, file.size)) * 0.95);
      } finally {
        try {
          if (uri) {
            const file = new File(uri);
            if (file.exists) file.delete();
          }
        } finally {
          image.release();
        }
      }
    }
    throw new Error('Capture exceeds upload limits.');
  } finally {
    context.release();
  }
}
