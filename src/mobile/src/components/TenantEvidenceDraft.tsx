import React, { useCallback, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { Text } from 'react-native-paper';
import { useFocusEffect } from 'expo-router';
import { CameraCapture } from './CameraCapture';
import { Action, Box, ui } from './WorkspaceKit';

export function validateTenantEvidence(bytes: Uint8Array) {
  if (!bytes.length || bytes.byteLength > 5 * 1024 * 1024)
    return 'Mỗi ảnh phải có dung lượng từ 1 byte đến 5 MB.';
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const png = [137, 80, 78, 71, 13, 10, 26, 10].every((value, i) => bytes[i] === value);
  return jpeg || png ? '' : 'Chỉ nhận nội dung ảnh JPEG hoặc PNG.';
}

// Local-only evidence while the server contract is missing. Never upload or persist it.
export function TenantEvidenceDraft() {
  const [photos, setPhotos] = useState<Uint8Array[]>([]);
  const [error, setError] = useState('');
  const [focused, setFocused] = useState(true);
  const generation = useRef(0);
  const active = useRef(false);
  useFocusEffect(
    useCallback(() => {
      active.current = true;
      setFocused(true);
      const sub = AppState.addEventListener('change', (state) => {
        if (state !== 'active') {
          generation.current++;
          setPhotos([]);
        }
      });
      return () => {
        active.current = false;
        generation.current++;
        setFocused(false);
        setPhotos([]);
        setError('');
        sub.remove();
      };
    }, []),
  );
  function add(bytes: Uint8Array, epoch = generation.current) {
    if (!active.current || epoch !== generation.current) return;
    const message = validateTenantEvidence(bytes);
    if (message) {
      setError(message);
      return;
    }
    setError('');
    setPhotos((current) => (current.length < 5 ? [...current, bytes] : current));
  }
  return (
    <Box>
      <Text>Ảnh bản nháp: {photos.length}/5 · tối đa 5 MB/ảnh</Text>
      <Text>
        Ảnh chỉ ở trong bộ nhớ của màn hình, chưa tải lên và bị xóa khi rời màn hình. Không đính kèm
        giấy tờ cá nhân.
      </Text>
      {Platform.OS === 'web' ? (
        React.createElement('input', {
          type: 'file',
          accept: 'image/jpeg,image/png',
          multiple: true,
          disabled: photos.length >= 5,
          'aria-label': 'Chọn ảnh minh chứng',
          onChange: async (event: React.ChangeEvent<HTMLInputElement>) => {
            const epoch = generation.current;
            const files = Array.from(event.target.files ?? []);
            event.target.value = '';
            for (const file of files.slice(0, Math.max(0, 5 - photos.length))) {
              if (file.size > 5 * 1024 * 1024) {
                setError('Ảnh vượt quá 5 MB.');
                continue;
              }
              try {
                add(new Uint8Array(await file.arrayBuffer()), epoch);
              } catch {
                setError('Không đọc được ảnh. Hãy chọn lại.');
              }
            }
          },
        })
      ) : focused ? (
        <CameraCapture
          label="Chụp ảnh minh chứng"
          disabled={photos.length >= 5}
          reviewBeforeSubmit
          reviewActionLabel="Giữ ảnh trong bản nháp"
          reviewNotice="Ảnh chưa được gửi đến máy chủ. Chỉ chụp hiện trạng, không chụp giấy tờ cá nhân."
          onCapture={async (bytes) => add(bytes)}
        />
      ) : null}
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
      {photos.map((_, index) => (
        <Action
          secondary
          key={index}
          onPress={() => setPhotos((current) => current.filter((__, i) => i !== index))}
        >
          Bỏ ảnh {index + 1}
        </Action>
      ))}
    </Box>
  );
}
