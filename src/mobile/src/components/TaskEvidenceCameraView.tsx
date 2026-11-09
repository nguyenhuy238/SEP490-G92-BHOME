import React from 'react';
import { Image, Modal, StyleSheet, View } from 'react-native';
import { Button, IconButton, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors as c } from '../theme/theme';

// An opaque native modal keeps the workspace, tabs and task actions off the camera surface.
export function TaskEvidenceCameraView({
  visible,
  camera,
  preview,
  working,
  ready,
  disabled,
  retryOnly,
  error,
  onClose,
  onTake,
  onRetake,
  onUse,
  onOpen,
}: {
  visible: boolean;
  camera: React.ReactNode;
  preview: string;
  working: boolean;
  ready: boolean;
  disabled: boolean;
  retryOnly: boolean;
  error: string;
  onClose: () => void;
  onTake: () => void;
  onRetake: () => void;
  onUse: () => void;
  onOpen: () => void;
}) {
  const blocked = working || disabled;
  return (
    <Modal
      visible={visible}
      presentationStyle="fullScreen"
      animationType="slide"
      onRequestClose={() => {
        if (!working) onClose();
      }}
    >
      <SafeAreaView style={s.root} edges={['top', 'bottom', 'left', 'right']}>
        <View style={s.header}>
          <IconButton
            icon="close"
            accessibilityLabel="Đóng camera minh chứng"
            disabled={working}
            onPress={onClose}
          />
          <Text variant="titleMedium" style={s.title}>
            {preview ? 'Xem lại ảnh' : 'Chụp ảnh minh chứng'}
          </Text>
        </View>
        <View style={s.camera}>
          {preview ? (
            <Image
              source={{ uri: preview }}
              accessibilityLabel="Ảnh minh chứng vừa chụp"
              resizeMode="contain"
              style={{ flex: 1, width: '100%' }}
            />
          ) : (
            camera
          )}
        </View>
        <View style={s.controls}>
          {!!error && (
            <Text accessibilityRole="alert" style={{ color: c.red }}>
              {error}
            </Text>
          )}
          {preview ? (
            <>
              <View style={s.buttons}>
                <Button
                  mode="outlined"
                  disabled={blocked || retryOnly}
                  onPress={onRetake}
                  style={{ flex: 1 }}
                >
                  Chụp lại
                </Button>
                <Button
                  mode="contained"
                  loading={working}
                  disabled={blocked}
                  onPress={onUse}
                  style={{ flex: 1 }}
                >
                  {error ? 'Thử lại' : 'Dùng ảnh'}
                </Button>
              </View>
              {!!error && (
                <Button disabled={working} onPress={onClose}>
                  Hủy
                </Button>
              )}
            </>
          ) : camera ? (
            <>
              <Text style={s.hint}>Chụp rõ hiện trạng công việc.</Text>
              <TouchableRipple
                accessibilityRole="button"
                accessibilityLabel="Chụp ảnh minh chứng"
                disabled={blocked || !ready}
                onPress={onTake}
                borderless
                style={s.shutter}
              >
                <View style={[s.shutterInner, (blocked || !ready) && { opacity: 0.4 }]} />
              </TouchableRipple>
            </>
          ) : (
            <Button mode="contained" disabled={blocked} onPress={onOpen}>
              Mở lại camera
            </Button>
          )}
        </View>
      </SafeAreaView>
    </Modal>
  );
}
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.white },
  header: { flexDirection: 'row', alignItems: 'center', paddingRight: 12 },
  title: { flex: 1, color: c.primary },
  camera: { flex: 1, backgroundColor: '#111111', overflow: 'hidden' },
  controls: { padding: 16, gap: 10, backgroundColor: c.white },
  buttons: { flexDirection: 'row', gap: 12 },
  hint: { textAlign: 'center', color: c.muted },
  shutter: {
    alignSelf: 'center',
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 2,
    borderColor: c.primary,
    padding: 6,
  },
  shutterInner: { flex: 1, borderRadius: 30, backgroundColor: c.primary },
});
