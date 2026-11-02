import React, { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import { staffColors as s } from '../theme/theme';

interface Props {
  documentSide?: 'front' | 'back';
  camera: React.ReactNode;
  preview: string;
  working: boolean;
  disabled: boolean;
  ready: boolean;
  requestingPermission: boolean;
  error: string;
  onTake: () => void;
  onRetake: () => void;
  onUse: () => void;
  onRequestPermission: () => void;
  onManual: () => void;
}

// Pure presentation. The shared capture component owns camera resources and temporary files.
export function DocumentCameraView(props: Props) {
  const back = props.documentSide === 'back';
  const [area, setArea] = useState({ width: 0, height: 0 });
  const width = Math.max(0, Math.min(area.width - 40, (area.height - 40) * 1.586));
  const height = width / 1.586;
  const left = (area.width - width) / 2;
  const top = (area.height - height) / 2;
  return (
    <View style={styles.root}>
      <View style={styles.viewport} onLayout={({ nativeEvent }) => setArea(nativeEvent.layout)}>
        {props.camera}
        {!!props.preview && !props.working && (
          <Image
            accessibilityLabel="Ảnh CCCD vừa chụp"
            source={{ uri: props.preview }}
            resizeMode="contain"
            style={styles.fill}
          />
        )}
        {!!props.camera && !props.preview && width > 0 && (
          <View pointerEvents="none" style={styles.fill}>
            <View style={[styles.shade, { top: 0, left: 0, right: 0, height: top }]} />
            <View style={[styles.shade, { top: top + height, bottom: 0, left: 0, right: 0 }]} />
            <View style={[styles.shade, { top, left: 0, width: left, height }]} />
            <View style={[styles.shade, { top, right: 0, width: left, height }]} />
            <View style={[styles.guide, { top, left, width, height }]}>
              <View style={[styles.corner, styles.topLeft]} />
              <View style={[styles.corner, styles.topRight]} />
              <View style={[styles.corner, styles.bottomLeft]} />
              <View style={[styles.corner, styles.bottomRight]} />
            </View>
          </View>
        )}
        {(props.working || props.requestingPermission) && (
          <View style={styles.processing}>
            <ActivityIndicator size="large" color="#FFFFFF" />
            <Text style={styles.processingText}>
              {props.requestingPermission
                ? 'Đang xin quyền camera…'
                : props.preview
                  ? 'Đang nhận diện thông tin CCCD...'
                  : 'Đang chuẩn bị ảnh…'}
            </Text>
          </View>
        )}
        {!props.camera && !props.preview && !props.requestingPermission && !props.working && (
          <View style={styles.permission}>
            <Icon source="camera-outline" size={48} color="#FFFFFF" />
            <Text style={styles.lightText}>Cho phép sử dụng camera để chụp CCCD.</Text>
            <Button
              mode="contained"
              buttonColor={s.blue}
              onPress={props.onRequestPermission}
              contentStyle={styles.touch}
            >
              Mở camera
            </Button>
          </View>
        )}
      </View>
      <View style={styles.controls}>
        {!!props.error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {props.error}
          </Text>
        )}
        {props.preview && !props.working ? (
          <>
            <Text style={styles.lightText}>
              Kiểm tra ảnh rõ chữ, không lóa và không mất góc giấy tờ.
            </Text>
            <View style={styles.previewActions}>
              <Button
                mode="outlined"
                textColor="#FFFFFF"
                style={styles.retake}
                contentStyle={styles.touch}
                disabled={props.disabled}
                onPress={props.onRetake}
              >
                Chụp lại
              </Button>
              <Button
                mode="contained"
                buttonColor={s.blue}
                style={styles.use}
                contentStyle={styles.touch}
                disabled={props.disabled}
                onPress={props.onUse}
              >
                Sử dụng ảnh
              </Button>
            </View>
          </>
        ) : (
          !props.working && (
            <>
              <Text style={styles.instruction}>
                Đặt mặt {back ? 'sau' : 'trước'} CCCD vào khung
              </Text>
              <Text style={styles.lightText}>
                {back
                  ? 'Đảm bảo phần Ngày cấp rõ nét và đủ sáng'
                  : 'Giữ giấy tờ rõ nét và đủ ánh sáng'}
              </Text>
              <TouchableRipple
                borderless={false}
                accessibilityRole="button"
                accessibilityLabel={back ? 'Chụp ảnh mặt sau' : 'Chụp ảnh mặt trước'}
                disabled={!props.ready || props.disabled || props.requestingPermission}
                onPress={props.onTake}
                style={[styles.shutter, (!props.ready || props.disabled) && styles.shutterDisabled]}
              >
                <View style={styles.shutterInner} />
              </TouchableRipple>
            </>
          )
        )}
        <Button
          textColor="#E2E8F0"
          disabled={props.working || props.disabled || props.requestingPermission}
          onPress={props.onManual}
          contentStyle={styles.touch}
        >
          Nhập thủ công
        </Button>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#07121F' },
  viewport: { flex: 1, minHeight: 120, overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0 },
  shade: { position: 'absolute', backgroundColor: 'rgba(0, 0, 0, 0.55)' },
  guide: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.45)',
    borderRadius: 12,
  },
  corner: { position: 'absolute', width: 28, height: 28, borderColor: '#FFFFFF' },
  topLeft: { top: -1, left: -1, borderLeftWidth: 3, borderTopWidth: 3, borderTopLeftRadius: 12 },
  topRight: {
    top: -1,
    right: -1,
    borderRightWidth: 3,
    borderTopWidth: 3,
    borderTopRightRadius: 12,
  },
  bottomLeft: {
    bottom: -1,
    left: -1,
    borderLeftWidth: 3,
    borderBottomWidth: 3,
    borderBottomLeftRadius: 12,
  },
  bottomRight: {
    bottom: -1,
    right: -1,
    borderRightWidth: 3,
    borderBottomWidth: 3,
    borderBottomRightRadius: 12,
  },
  processing: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#07121F',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  processingText: { color: '#FFFFFF', fontSize: 16, lineHeight: 24, textAlign: 'center' },
  permission: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  controls: {
    gap: 8,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 8,
    alignItems: 'stretch',
  },
  instruction: {
    color: '#FFFFFF',
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '600',
    textAlign: 'center',
  },
  lightText: { color: '#CBD5E1', fontSize: 13, lineHeight: 20, textAlign: 'center' },
  shutter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    padding: 5,
    alignSelf: 'center',
    marginVertical: 8,
  },
  shutterInner: { flex: 1, borderRadius: 40, backgroundColor: '#FFFFFF' },
  shutterDisabled: { opacity: 0.4 },
  previewActions: { flexDirection: 'row', gap: 12 },
  retake: { flex: 1, borderColor: '#94A3B8', borderRadius: 12 },
  use: { flex: 1, borderRadius: 12 },
  touch: { minHeight: 48 },
  error: { color: '#FECACA', fontSize: 13, lineHeight: 20, textAlign: 'center' },
});
