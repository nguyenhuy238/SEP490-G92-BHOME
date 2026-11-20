import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { CameraView, type CameraViewProps } from 'expo-camera';
import { Button, Text } from 'react-native-paper';
import { captureLensOptions } from '../lib/captureLenses';

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
  children,
}: {
  camera: React.RefObject<CameraView | null>;
  disabled: boolean;
  onReady: (ready: boolean) => void;
  onError: () => void;
  dark?: boolean;
  showControls?: boolean;
  children?: React.ReactNode;
}) {
  const [lens, setLens] = useState('');
  const [lenses, setLenses] = useState<ReturnType<typeof captureLensOptions>>([]);
  const [zoom, setZoom] = useState(0);
  const [settling, setSettling] = useState(true);
  const mounted = useRef(true);
  const started = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selected = useRef('');
  const switching = useRef(false);
  const readyCallback = useRef(onReady);
  useEffect(() => {
    readyCallback.current = onReady;
  }, [onReady]);
  const settle = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    readyCallback.current(false);
    setSettling(true);
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
      if (selected.current && !options.some((option) => option.id === selected.current)) {
        selected.current = '';
        setLens('');
        setZoom(0);
      }
      // SDK 58 emits discovery again after committing an iOS lens switch.
      if (started.current) settle();
    },
    [settle],
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
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, overflow: 'hidden' }}>
        <CameraView
          ref={camera}
          style={{ flex: 1 }}
          facing="back"
          mode="picture"
          // SDK 58 maps off to continuousAutoFocus on iOS. Android uses CameraX AF.
          autofocus="off"
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
