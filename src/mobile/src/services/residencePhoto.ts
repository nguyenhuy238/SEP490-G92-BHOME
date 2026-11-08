import { Platform } from 'react-native';
import type { ImagePickerAsset } from 'expo-image-picker';
import {
  residenceImageType,
  residenceImageUri,
} from '../../../../packages/client-core/src/residence';

export async function readResidencePhoto(asset: ImagePickerAsset) {
  if (asset.mimeType && !['image/jpeg', 'image/png'].includes(asset.mimeType))
    throw new Error('Chỉ nhận ảnh JPG hoặc PNG.');
  if ((asset.fileSize ?? 0) > 5 * 1024 * 1024) throw new Error('Ảnh cần nhỏ hơn hoặc bằng 5 MB.');
  let bytes: Uint8Array<ArrayBuffer>;
  if (Platform.OS === 'web') {
    if (!asset.file) throw new Error('Không đọc được ảnh đã chọn.');
    bytes = new Uint8Array(await asset.file.arrayBuffer());
  } else {
    const { File, Paths } = await import('expo-file-system');
    const file = new File(asset.uri);
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('Ảnh cần nhỏ hơn hoặc bằng 5 MB.');
      bytes = await file.bytes();
    } finally {
      // Only remove the picker copy in app cache, never the user's original in Photos.
      if (asset.uri.startsWith(Paths.cache.uri) && file.exists) file.delete();
    }
  }
  try {
    residenceImageType(bytes);
    return { bytes, uri: residenceImageUri(bytes) };
  } catch (failure) {
    bytes.fill(0);
    throw failure;
  }
}
