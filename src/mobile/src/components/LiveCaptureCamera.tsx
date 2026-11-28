import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { CameraView, type CameraViewProps } from 'expo-camera';
import { Button, Text } from 'react-native-paper';
import { captureLensOptions } from '../lib/captureLenses';
import {
  acceptCameraFocusEvent,
  cameraFocusMessage,
  supportsNativeCameraFocus,
  type CameraFocusEvent,
} from '../lib/cameraFocus';

// Expo Camera forwards native props. The config plugin registers these additions
// on the existing Expo view, and the runtime version check protects Expo Go.
const FocusCameraView = CameraView as unknown as React.ComponentType<
  CameraViewProps & {
    ref: React.RefObject<CameraView | null>;
    bhomeFocusEnabled?: boolean;
    onBhomeFocusChanged?: (event: { nativeEvent: CameraFocusEvent }) => void;
  }
>;

// Preserve the existing normalized zoom ceiling pending physical-device calibration.
// Expo's 0..1 range is device-dependent and does not represent an optical multiplier.
const zoomCeiling = 0.12;
const settleMilliseconds = 500;

export function LiveCaptureCamera({
  camera,
  disabled,
  onReady,
  onError,
  dark = false,
  showControls = true,
  previewHeight,
  lensPreferenceRef,
  children,
}: {
  camera: React.RefObject<CameraView | null>;
  disabled: boolean;
  onReady: (ready: boolean) => void;
  onError: () => void;
  dark?: boolean;
  showControls?: boolean;
  previewHeight?: number;
  lensPreferenceRef?: { current: string };
  children?: React.ReactNode;
}) {
  const [lens, setLens] = useState('');
  const [lenses, setLenses] = useState<ReturnType<typeof captureLensOptions>>([]);
  const [zoom, setZoom] = useState(0);
  const [settling, setSettling] = useState(true);
  const [focus, setFocus] = useState<CameraFocusEvent | null>(null);
  const [nativeFocus] = useState(supportsNativeCameraFocus);
  const mounted = useRef(true);
  const started = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selected = useRef('');
  const preferenceRestored = useRef(false);
  const switching = useRef(false);
  const focusRequest = useRef(-1);
  const focusFloor = useRef(0);
  const readyCallback = useRef(onReady);
  useEffect(() => {
    readyCallback.current = onReady;
  }, [onReady]);
  const settle = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    readyCallback.current(false);
    setSettling(true);
    // Disable/enable in native increments its generation. Require a fresh event
    // after zoom/lens changes, including a late result with the last accepted ID.
    focusFloor.current = focusRequest.current + 1;
    setFocus(null);
    timer.current = setTimeout(() => {
      if (!mounted.current || !started.current) return;
      switching.current = false;
      setSettling(false);
      readyCallback.current(true);
    }, settleMilliseconds);
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      started.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const reportLenses = useCallback(
    (reported: unknown) => {
      if (!mounted.current) return;
      const options = captureLensOptions(reported);
      setLenses(options);
      if (!preferenceRestored.current && options.length > 0) {
        preferenceRestored.current = true;
        const preferred = lensPreferenceRef?.current ?? '';
        // Restore only an actually discovered physical lens, including Expo Go.
        // Keep the user's close-focus choice across preview/retake/front-back.
        if (preferred && options.some((option) => option.id === preferred)) {
          selected.current = preferred;
          setLens(preferred);
        } else if (lensPreferenceRef) lensPreferenceRef.current = '';
      }
      if (
        options.length > 0 &&
        selected.current &&
        !options.some((option) => option.id === selected.current)
      ) {
        selected.current = '';
        setLens('');
        setZoom(0);
        if (lensPreferenceRef) lensPreferenceRef.current = '';
      }
      // SDK 58 emits discovery again after committing an iOS lens switch.
      if (started.current) settle();
    },
    [settle, lensPreferenceRef],
  );
  const handleReady = useCallback(() => {
    if (!mounted.current) return;
    started.current = true;
    settle();
    if (Platform.OS === 'ios') {
      void camera.current
        ?.getAvailableLensesAsync()
        .then(reportLenses)
        .catch(() => {
          // Continuous AF and the native default device remain available without discovery.
        });
    }
  }, [camera, reportLenses, settle]);
  const handleLenses: CameraViewProps['onAvailableLensesChanged'] = useCallback(
    ({ lenses: reported }: { lenses: unknown }) => reportLenses(reported),
    [reportLenses],
  );
  const blocked = disabled || settling;
  const textColor = dark ? '#CBD5E1' : undefined;
  const focusMessage = settling ? 'Đang mở camera…' : cameraFocusMessage(focus, nativeFocus);
  return (
    <View style={previewHeight ? { width: '100%' } : { flex: 1 }}>
      <View
        style={
          previewHeight
            ? { height: previewHeight, width: '100%', overflow: 'hidden' }
            : { flex: 1, overflow: 'hidden' }
        }
      >
        <FocusCameraView
          ref={camera}
          style={{ flex: 1, width: '100%' }}
          facing="back"
          mode="picture"
          // SDK 58 maps off to continuousAutoFocus on iOS. Android uses CameraX AF.
          autofocus="off"
          bhomeFocusEnabled={nativeFocus ? !disabled && !settling : undefined}
          onBhomeFocusChanged={
            nativeFocus
              ? ({ nativeEvent }) => {
                  if (!mounted.current || !started.current || disabled || settling) return;
                  const event = acceptCameraFocusEvent(null, nativeEvent);
                  if (
                    !event ||
                    event.requestId < focusRequest.current ||
                    event.requestId < focusFloor.current
                  )
                    return;
                  focusRequest.current = event.requestId;
                  setFocus((previous) => acceptCameraFocusEvent(previous, event));
                }
              : undefined
          }
          selectedLens={Platform.OS === 'ios' && lens ? lens : undefined}
          zoom={zoom}
          onCameraReady={handleReady}
          onAvailableLensesChanged={Platform.OS === 'ios' ? handleLenses : undefined}
          onMountError={() => {
            started.current = false;
            if (timer.current) clearTimeout(timer.current);
            if (!mounted.current) return;
            readyCallback.current(false);
            onError();
          }}
        />
        {children}
        {nativeFocus && focus && focus.x >= 0 && focus.y >= 0 && (
          <View
            pointerEvents="none"
            accessibilityLabel="Điểm lấy nét"
            style={{
              position: 'absolute',
              left: `${focus.x * 100}%`,
              top: `${focus.y * 100}%`,
              width: 56,
              height: 56,
              marginLeft: -28,
              marginTop: -28,
              borderWidth: 2,
              borderRadius: 12,
              borderColor: focus.state === 'focused' ? '#86EFAC' : '#FFFFFF',
            }}
          />
        )}
        {showControls && !!focusMessage && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 8, left: 8, right: 8 }}>
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: '#FFFFFF', backgroundColor: '#07121F', padding: 8, borderRadius: 8 }}
            >
              {focusMessage}
            </Text>
          </View>
        )}
      </View>
      {showControls && (
        <View style={{ gap: 4, padding: 8, backgroundColor: dark ? '#07121F' : '#FFFFFF' }}>
          {Platform.OS === 'ios' && lenses.length > 0 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
              {[{ id: '', label: 'Tự động' }, ...lenses].map((option) => (
                <Button
                  key={option.id}
                  mode={lens === option.id ? 'contained' : 'outlined'}
                  textColor={lens === option.id ? undefined : textColor}
                  disabled={blocked}
                  contentStyle={{ minHeight: 48 }}
                  onPress={() => {
                    if (switching.current || blocked || selected.current === option.id) return;
                    switching.current = true;
                    selected.current = option.id;
                    if (lensPreferenceRef) lensPreferenceRef.current = option.id;
                    settle();
                    setZoom(0);
                    setLens(option.id);
                  }}
                >
                  {option.label}
                </Button>
              ))}
            </View>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
            <Button
              textColor={textColor}
              disabled={blocked || zoom <= 0}
              contentStyle={{ minHeight: 48 }}
              onPress={() => {
                settle();
                setZoom((value) => Math.max(0, value - 0.02));
              }}
            >
              Thu bớt
            </Button>
            <Button
              textColor={textColor}
              disabled={blocked || zoom >= zoomCeiling}
              contentStyle={{ minHeight: 48 }}
              onPress={() => {
                settle();
                setZoom((value) => Math.min(zoomCeiling, value + 0.02));
              }}
            >
              Phóng thêm
            </Button>
            <Text style={{ color: textColor }}>Zoom {Math.round(zoom * 100)}%</Text>
          </View>
          <Text style={{ color: textColor }}>
            Nếu mờ, lùi máy, giữ yên và chờ chữ rõ rồi chụp. Cần đủ sáng, tránh lóa.
          </Text>
          {zoom > 0 && (
            <Text style={{ color: textColor }}>
              Zoom theo thang thiết bị, có thể giảm chi tiết. Chụp gần tùy khả năng lấy nét của máy.
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
