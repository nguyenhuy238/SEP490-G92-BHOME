import React, { useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { Button, IconButton, Text } from 'react-native-paper';
import { CameraCapture } from './CameraCapture';
import { randomUUID } from '../lib/randomUUID';
import { validateIncidentPhoto, type IncidentPhoto } from '../services/incidents';
import { ui } from './WorkspaceKit';

export function incidentPhotoUri(bytes: Uint8Array) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const parts: string[] = [];
  let chunk = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i],
      b = bytes[i + 1] ?? 0,
      c = bytes[i + 2] ?? 0;
    chunk +=
      alphabet[a >> 2] +
      alphabet[((a & 3) << 4) | (b >> 4)] +
      (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)] : '=') +
      (i + 2 < bytes.length ? alphabet[c & 63] : '=');
    if (chunk.length >= 8192) {
      parts.push(chunk);
      chunk = '';
    }
  }
  parts.push(chunk);
  return `data:image/${bytes[0] === 137 ? 'png' : 'jpeg'};base64,${parts.join('')}`;
}
function decodePhoto(value: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = value.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let bits = 0,
    buffer = 0,
    offset = 0;
  for (const c of clean) {
    const digit = alphabet.indexOf(c);
    if (digit < 0) throw new Error('Ảnh mã hóa không hợp lệ.');
    buffer = (buffer << 6) | digit;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[offset++] = (buffer >> bits) & 255;
    }
  }
  return bytes;
}
export function IncidentEvidencePicker({
  value,
  onChange,
  disabled = false,
}: {
  value?: IncidentPhoto[];
  onChange?: (photos: IncidentPhoto[]) => void;
  disabled?: boolean;
}) {
  const [local, setLocal] = useState<IncidentPhoto[]>([]);
  const [error, setError] = useState(''),
    [picking, setPicking] = useState(false);
  const alive = useRef(true),
    current = useRef(value ?? local);
  useEffect(() => {
    current.current = value ?? local;
  }, [value, local]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const update = (photos: IncidentPhoto[]) => {
    if (onChange) onChange(photos);
    else setLocal(photos);
  };
  function add(bytes: Uint8Array<ArrayBuffer>) {
    if (!alive.current || disabled) return;
    const message = validateIncidentPhoto(bytes);
    if (message) {
      setError(message);
      return;
    }
    if (current.current.length >= 5) {
      setError('Chỉ chọn tối đa 5 ảnh.');
      return;
    }
    const photos = [
      ...current.current,
      {
        id: randomUUID(),
        bytes,
        contentType: bytes[0] === 137 ? ('image/png' as const) : ('image/jpeg' as const),
      },
    ];
    current.current = photos;
    update(photos);
    setError('');
  }
  async function choose() {
    if (disabled || picking) return;
    setPicking(true);
    setError('');
    try {
      const picker = await import('expo-image-picker');
      const result = await picker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit: 5 - current.current.length,
        base64: true,
        quality: 0.85,
        exif: false,
      });
      if (!result.canceled && alive.current) {
        for (const asset of result.assets) {
          if (asset.fileSize && asset.fileSize > 5_000_000) {
            setError('Ảnh vượt quá 5.000.000 byte.');
            continue;
          }
          if (!asset.base64) {
            setError('Không đọc được ảnh đã chọn. Hãy chụp lại hoặc chọn ảnh khác.');
            continue;
          }
          add(decodePhoto(asset.base64));
        }
      }
    } catch {
      if (alive.current)
        setError('Không mở được thư viện ảnh. Kiểm tra quyền ảnh hoặc chụp bằng camera.');
    } finally {
      if (alive.current) setPicking(false);
    }
  }
  const photos = value ?? local;
  return (
    <View style={{ gap: 8 }}>
      <Text>Ảnh minh chứng {photos.length}/5 · tối đa 5.000.000 byte/ảnh.</Text>
      <Text style={ui.muted}>
        Ảnh chỉ được tải lên khi gửi thao tác. Không chụp giấy tờ cá nhân.
      </Text>
      <CameraCapture
        label="Chụp ảnh hiện trường"
        disabled={disabled || picking || photos.length >= 5}
        reviewBeforeSubmit
        reviewActionLabel="Chọn ảnh này"
        onCapture={async (bytes) => add(bytes)}
      />
      <Button
        icon="image-outline"
        disabled={disabled || picking || photos.length >= 5}
        loading={picking}
        onPress={() => void choose()}
      >
        Chọn ảnh từ thư viện
      </Button>
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {photos.map((photo, index) => (
          <View key={photo.id} style={{ width: 100 }}>
            <Image
              source={{ uri: incidentPhotoUri(photo.bytes) }}
              accessibilityLabel={`Ảnh hiện trường ${index + 1}`}
              style={{ width: 100, height: 100, borderRadius: 10 }}
            />
            <IconButton
              icon="close-circle"
              disabled={disabled}
              accessibilityLabel={`Xóa ảnh hiện trường ${index + 1}`}
              onPress={() => {
                const next = photos.filter((item) => item.id !== photo.id);
                current.current = next;
                update(next);
              }}
            />
          </View>
        ))}
      </View>
    </View>
  );
}
