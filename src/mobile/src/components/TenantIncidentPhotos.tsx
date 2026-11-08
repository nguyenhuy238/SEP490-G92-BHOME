import React, { useEffect, useRef, useState } from 'react';
import { Image, Modal, Platform, View } from 'react-native';
import { Button, IconButton, Text, TouchableRipple } from 'react-native-paper';
import { randomUUID } from '../lib/randomUUID';
import { validateIncidentPhoto, type IncidentPhoto } from '../services/incidents';
import { reportColors as c, reportUi as s } from '../features/incidents/TenantIncidentStyle';
import type { ImagePickerAsset } from 'expo-image-picker';

export interface TenantIncidentPhoto extends IncidentPhoto {
  previewUri: string;
}
export async function readPickedIncidentPhoto(
  asset: ImagePickerAsset,
): Promise<TenantIncidentPhoto> {
  if (asset.mimeType && !['image/png', 'image/jpeg'].includes(asset.mimeType))
    throw new Error('Chỉ nhận ảnh JPG/PNG. Vui lòng chọn ảnh khác.');
  let uri = asset.uri;
  // IncidentFiles.Validate also enforces 12,000,000 pixels and 16,000px per edge.
  // Re-encode oversized camera dimensions, rather than merely renaming an extension.
  if (
    asset.width * asset.height > 12_000_000 ||
    asset.width > 16000 ||
    asset.height > 16000 ||
    (asset.fileSize ?? 0) > 5_000_000
  ) {
    const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
    const context = ImageManipulator.manipulate(uri);
    try {
      const ratio = Math.min(1, 1920 / Math.max(asset.width, asset.height));
      context.resize({
        width: Math.max(1, Math.round(asset.width * ratio)),
        height: Math.max(1, Math.round(asset.height * ratio)),
      });
      const image = await context.renderAsync();
      try {
        uri = (await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 })).uri;
      } finally {
        image.release();
      }
    } finally {
      context.release();
    }
  }
  let bytes: Uint8Array<ArrayBuffer>;
  if (Platform.OS === 'web') {
    if (uri === asset.uri && asset.file) bytes = new Uint8Array(await asset.file.arrayBuffer());
    else if (/^(blob:|data:image\/)/.test(uri))
      bytes = new Uint8Array(await (await fetch(uri)).arrayBuffer());
    else throw new Error('Không đọc được ảnh đã chọn.');
  } else {
    const { File } = await import('expo-file-system');
    const file = new File(uri);
    if (file.size > 5_000_000)
      throw new Error('Ảnh vượt quá 5.000.000 byte. Vui lòng chọn ảnh nhỏ hơn.');
    bytes = await file.bytes();
  }
  const error = validateIncidentPhoto(bytes);
  if (error) throw new Error(error);
  return {
    id: randomUUID(),
    bytes,
    contentType: bytes[0] === 137 ? 'image/png' : 'image/jpeg',
    previewUri: uri,
  };
}
export function TenantIncidentPhotos({
  value,
  onChange,
  disabled,
  onBusyChange,
}: {
  value: TenantIncidentPhoto[];
  onChange: (photos: TenantIncidentPhoto[]) => void;
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [error, setError] = useState(''),
    [picking, setPicking] = useState(false),
    [preview, setPreview] = useState<TenantIncidentPhoto | null>(null);
  const alive = useRef(true),
    lock = useRef(false),
    current = useRef(value);
  useEffect(() => {
    current.current = value;
  }, [value]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function pick(camera: boolean) {
    if (disabled || lock.current || current.current.length >= 5) return;
    lock.current = true;
    setPicking(true);
    onBusyChange(true);
    setError('');
    try {
      const picker = await import('expo-image-picker');
      if (camera) {
        const permission = await picker.requestCameraPermissionsAsync();
        if (!permission.granted)
          throw new Error(
            'Chưa có quyền camera. Bạn có thể cấp quyền trong Cài đặt hoặc chọn ảnh từ thư viện.',
          );
      }
      const options = {
        mediaTypes: ['images'] as 'images'[],
        quality: 1,
        exif: false,
        base64: false,
      };
      // The system photo picker grants access to selected files; no broad library permission needed.
      const result = camera
        ? await picker.launchCameraAsync(options)
        : await picker.launchImageLibraryAsync({
            ...options,
            allowsMultipleSelection: true,
            selectionLimit: 5 - current.current.length,
          });
      if (result.canceled || !alive.current) return;
      if (result.assets.length + current.current.length > 5)
        throw new Error('Chỉ chọn tối đa 5 ảnh. Những ảnh đã chọn trước vẫn được giữ.');
      const additions: TenantIncidentPhoto[] = [];
      for (const asset of result.assets) {
        if (!alive.current) return;
        additions.push(await readPickedIncidentPhoto(asset));
      }
      if (alive.current) onChange([...current.current, ...additions]);
    } catch (cause) {
      if (alive.current)
        setError(
          cause instanceof Error && /^(Chỉ nhận|Ảnh |Chỉ chọn|Chưa có quyền)/.test(cause.message)
            ? cause.message
            : 'Không mở hoặc đọc được ảnh. Kiểm tra quyền camera/thư viện và thử lại.',
        );
    } finally {
      lock.current = false;
      if (alive.current) {
        setPicking(false);
        onBusyChange(false);
      }
    }
  }
  return (
    <View style={{ gap: 10 }}>
      <View style={s.row}>
        <Text style={[s.helper, s.grow]}>Tối đa 5 ảnh JPG/PNG, mỗi ảnh không quá 5 MB</Text>
        <Text style={s.label}>{value.length}/5</Text>
      </View>
      <View style={s.row}>
        <Button
          compact
          mode="outlined"
          icon="camera-outline"
          disabled={disabled || picking || value.length >= 5}
          onPress={() => void pick(true)}
          style={{ flex: 1, borderRadius: 12 }}
          contentStyle={{ minHeight: 44 }}
        >
          Chụp ảnh
        </Button>
        <Button
          compact
          mode="outlined"
          icon="image-outline"
          loading={picking}
          disabled={disabled || picking || value.length >= 5}
          onPress={() => void pick(false)}
          style={{ flex: 1, borderRadius: 12 }}
          contentStyle={{ minHeight: 44 }}
        >
          Thư viện
        </Button>
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={s.error}>
          {error}
        </Text>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {value.map((photo, index) => (
          <View key={photo.id} style={{ width: 88, height: 88 }}>
            <TouchableRipple
              accessibilityRole="button"
              accessibilityLabel={`Xem ảnh hiện trường ${index + 1}`}
              onPress={() => setPreview(photo)}
            >
              <Image
                source={{ uri: photo.previewUri }}
                accessibilityLabel={`Ảnh hiện trường ${index + 1}`}
                style={{ width: 88, height: 88, borderRadius: 12 }}
              />
            </TouchableRipple>
            <IconButton
              icon="close-circle"
              iconColor={c.navy}
              size={22}
              style={{ position: 'absolute', right: -6, top: -6, backgroundColor: 'white' }}
              disabled={disabled || picking}
              accessibilityLabel={`Xóa ảnh hiện trường ${index + 1}`}
              onPress={() => onChange(value.filter((item) => item.id !== photo.id))}
            />
          </View>
        ))}
      </View>
      <Modal
        visible={!!preview}
        transparent
        animationType="fade"
        onRequestClose={() => setPreview(null)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.92)',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <Button mode="contained" onPress={() => setPreview(null)}>
            Đóng ảnh
          </Button>
          {preview && (
            <Image
              source={{ uri: preview.previewUri }}
              resizeMode="contain"
              style={{ width: '100%', height: '75%' }}
              accessibilityLabel="Ảnh hiện trường phóng lớn"
            />
          )}
        </View>
      </Modal>
    </View>
  );
}
