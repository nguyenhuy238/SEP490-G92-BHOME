import React from 'react';
import { Image, View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { colors as c } from '../theme/theme';

// Presentation only: permissions, capture, temporary files and upload stay in CameraCapture.
export function MeterCameraView({
  camera,
  preview,
  step,
  label,
  disabled,
  working,
  ready,
  requestingPermission,
  error,
  onOpen,
  onTake,
  onClose,
  onUse,
  onRetake,
}: {
  camera: React.ReactNode;
  preview: string;
  step: number;
  label: string;
  disabled: boolean;
  working: boolean;
  ready: boolean;
  requestingPermission: boolean;
  error: string;
  onOpen: () => void;
  onTake: () => void;
  onClose: () => void;
  onUse: () => void;
  onRetake: () => void;
}) {
  const blocked = disabled || working || requestingPermission;
  return (
    <View style={{ gap: 12 }}>
      {camera ? (
        <>
          <View
            style={{ height: 260, borderRadius: 12, overflow: 'hidden', backgroundColor: c.ink }}
          >
            {camera}
          </View>
          <Button
            mode="contained"
            contentStyle={{ minHeight: 48 }}
            disabled={blocked || !ready}
            onPress={onTake}
          >
            Chụp ảnh
          </Button>
          <Button disabled={blocked} onPress={onClose}>
            Đóng camera
          </Button>
        </>
      ) : preview ? (
        <>
          <Image
            accessibilityLabel="Ảnh công tơ đã chụp"
            source={{ uri: preview }}
            resizeMode="contain"
            style={{
              width: '100%',
              height: step === 1 ? 260 : 150,
              borderRadius: 12,
              backgroundColor: c.soft,
            }}
          />
          {step === 1 && (
            <>
              <Button
                mode="contained"
                contentStyle={{ minHeight: 48 }}
                disabled={blocked}
                onPress={onUse}
              >
                Dùng ảnh này
              </Button>
              <Button
                mode="outlined"
                contentStyle={{ minHeight: 48 }}
                disabled={blocked}
                onPress={onRetake}
              >
                Chụp lại
              </Button>
            </>
          )}
          {step === 2 && (
            <Button disabled={blocked} onPress={onUse}>
              Thử lại OCR
            </Button>
          )}
        </>
      ) : (
        <>
          <View
            style={{
              minHeight: 150,
              borderRadius: 12,
              backgroundColor: c.soft,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
            }}
          >
            <Icon source="camera-outline" size={36} color={c.muted} />
            <Text style={{ color: c.muted }}>Chưa có ảnh công tơ</Text>
          </View>
          <Button
            mode="contained"
            icon="camera-outline"
            contentStyle={{ minHeight: 48 }}
            loading={requestingPermission}
            disabled={blocked}
            onPress={onOpen}
          >
            {label}
          </Button>
        </>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={{ color: c.red }}>
          {error}
        </Text>
      )}
    </View>
  );
}
