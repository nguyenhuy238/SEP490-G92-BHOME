import React, { useEffect, useState } from 'react';
import { Image, Platform, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import { CameraCapture } from './CameraCapture';
import { FloatingDemoPhotoButton } from './FloatingDemoPhotoButton';
import { incidentPhotoUri } from './IncidentEvidencePicker';
import { validateIncidentPhoto, type IncidentPhoto } from '../services/incidents';
import { randomUUID } from '../lib/randomUUID';
import { operationalTasks } from '../services/operationalTasks';
import type { MobileApi } from '../lib/api';
import { colors } from '../theme/theme';
import { canUseLocalMeterDemo, meterDemoJpegBytes } from '../lib/meterDemoCapture';

function createInventoryDemoPhoto(): Uint8Array<ArrayBuffer> {
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 480;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Không tạo được ảnh mẫu DEV trên trình duyệt.');
  context.fillStyle = '#edf2f9';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#172b4d';
  context.fillRect(36, 36, 728, 408);
  context.fillStyle = '#ffffff';
  context.font = 'bold 44px sans-serif';
  context.fillText('BHOME - ANH MAU DEV', 66, 172);
  context.font = 'bold 29px sans-serif';
  context.fillText('KHONG PHAI TAI SAN THUC TE', 66, 248);
  context.font = '23px sans-serif';
  context.fillText('Chi dung thu kiem ke va tai anh', 66, 323);
  return meterDemoJpegBytes(canvas.toDataURL('image/jpeg', 0.85));
}

function SavedThumbnail({ api, taskId, id }: { api: MobileApi; taskId: string; id: string }) {
  const [uri, setUri] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void operationalTasks(api)
      .imageBytes(taskId, id, abort.signal)
      .then((bytes) => {
        try {
          if (!abort.signal.aborted && !validateIncidentPhoto(bytes))
            setUri(incidentPhotoUri(bytes));
          else if (!abort.signal.aborted) setFailed(true);
        } finally {
          bytes.fill(0);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setFailed(true);
      });
    return () => abort.abort();
  }, [api, taskId, id]);
  return uri ? (
    <Image
      source={{ uri }}
      resizeMode="cover"
      accessibilityLabel="Ảnh minh chứng đã lưu"
      style={{ width: '100%', height: 110, borderRadius: 10 }}
    />
  ) : (
    <View style={{ height: 110, alignItems: 'center', justifyContent: 'center' }}>
      <Text variant="bodySmall" style={{ color: colors.muted }}>
        {failed ? 'Không xem được ảnh' : 'Đang tải ảnh…'}
      </Text>
    </View>
  );
}

export function InventoryPhotoCapture({
  api,
  taskId,
  savedIds,
  photos,
  disabled,
  onChange,
  onRemoveSaved,
  error,
  developmentDemo = false,
  required = true,
}: {
  api: MobileApi;
  taskId: string;
  savedIds: string[];
  photos: IncidentPhoto[];
  disabled: boolean;
  onChange: (photos: IncidentPhoto[]) => void;
  onRemoveSaved: (id: string) => void;
  error?: string;
  developmentDemo?: boolean;
  required?: boolean;
}) {
  const [captureError, setCaptureError] = useState('');
  const count = savedIds.length + photos.length;
  const canUseSample =
    developmentDemo &&
    canUseLocalMeterDemo(
      typeof __DEV__ !== 'undefined' && __DEV__,
      Platform.OS,
      globalThis.location?.hostname,
      globalThis.location?.port,
    );
  return (
    <View style={{ gap: 8 }}>
      <Text variant="labelMedium" style={{ color: error ? colors.red : colors.navy }}>
        {required ? 'Ảnh minh chứng *' : 'Ảnh minh chứng (không bắt buộc)'}
      </Text>
      <CameraCapture
        label="Chụp ảnh"
        presentation="evidence"
        disabled={disabled || count >= 5}
        reviewBeforeSubmit
        reviewActionLabel="Dùng ảnh này"
        onCapture={async (bytes) => {
          const problem = validateIncidentPhoto(bytes);
          if (problem || count >= 5) {
            setCaptureError(problem || 'Tối đa 5 ảnh minh chứng cho một tài sản.');
            return false;
          }
          // CameraCapture clears its input buffer after the callback; keep a
          // private in-memory copy only until the explicit Save operation.
          const copy = Uint8Array.from(bytes);
          onChange([
            ...photos,
            {
              id: randomUUID(),
              bytes: copy,
              contentType: copy[0] === 137 ? 'image/png' : 'image/jpeg',
            },
          ]);
          setCaptureError('');
          return true;
        }}
      />
      {!!(error || captureError) && (
        <Text accessibilityRole="alert" style={{ color: colors.red }}>
          {error || captureError}
        </Text>
      )}
      {count > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {savedIds.map((id, index) => (
            <View key={id} style={{ width: '47%', minWidth: 104, maxWidth: 175, flexGrow: 1 }}>
              <SavedThumbnail api={api} taskId={taskId} id={id} />
              {!disabled && (
                <IconButton
                  icon="close"
                  size={18}
                  accessibilityLabel={`Xóa ảnh minh chứng ${index + 1}`}
                  onPress={() => onRemoveSaved(id)}
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    margin: 2,
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: '#ffffff',
                  }}
                />
              )}
            </View>
          ))}
          {photos.map((photo, index) => (
            <View
              key={photo.id}
              style={{ width: '47%', minWidth: 104, maxWidth: 175, flexGrow: 1 }}
            >
              <Image
                source={{ uri: incidentPhotoUri(photo.bytes) }}
                resizeMode="cover"
                accessibilityLabel={`Ảnh minh chứng mới ${index + 1}`}
                style={{ width: '100%', height: 110, borderRadius: 10 }}
              />
              {!disabled && (
                <IconButton
                  icon="close"
                  size={18}
                  accessibilityLabel={`Xóa ảnh minh chứng ${savedIds.length + index + 1}`}
                  onPress={() => onChange(photos.filter((entry) => entry.id !== photo.id))}
                  style={{
                    position: 'absolute',
                    top: 0,
                    right: 0,
                    margin: 2,
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: '#ffffff',
                  }}
                />
              )}
            </View>
          ))}
        </View>
      )}
      {canUseSample && (
        <FloatingDemoPhotoButton
          disabled={disabled || count >= 5}
          onPress={() => {
            if (!canUseSample || disabled || count >= 5) return;
            try {
              const bytes = createInventoryDemoPhoto();
              const problem = validateIncidentPhoto(bytes);
              if (problem) throw new Error(problem);
              onChange([...photos, { id: randomUUID(), bytes, contentType: 'image/jpeg' }]);
              setCaptureError('');
            } catch (failure) {
              setCaptureError(
                failure instanceof Error ? failure.message : 'Không tạo được ảnh mẫu DEV.',
              );
            }
          }}
        />
      )}
    </View>
  );
}
