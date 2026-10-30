import React, { useEffect, useRef, useState } from 'react';
import { AppState, Image, Platform, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Button, SegmentedButtons, Text } from 'react-native-paper';
import { styles } from './Controls';
import { ownCapture } from '../lib/captureFiles';
import { captureLensOptions } from '../lib/captureLenses';

// Only URIs created by this component in the application's cache are accepted for deletion.
function remove(uri: string) {
  if (uri.startsWith(Paths.cache.uri)) {
    const f = new File(uri);
    if (f.exists) f.delete();
  }
}
export function CameraCapture({
  label,
  disabled,
  onCapture,
  retainPreview = false,
  reviewBeforeSubmit = false,
  documentSide,
}: {
  label: string;
  disabled: boolean;
  onCapture: (bytes: Uint8Array<ArrayBuffer>) => Promise<void>;
  retainPreview?: boolean;
  reviewBeforeSubmit?: boolean;
  documentSide?: 'front' | 'back';
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [lens, setLens] = useState('');
  const [lenses, setLenses] = useState<{ id: string; label: string }[]>([]);
  const [zoom, setZoom] = useState(0);
  const [cameraGeneration, setCameraGeneration] = useState(0);
  const files = useRef(new Set<string>());
  const pending = useRef('');
  const alive = useRef(true);
  const generation = useRef(0);
  const clearFiles = () => {
    for (const uri of files.current) remove(uri);
    files.current.clear();
    pending.current = '';
  };
  useEffect(() => {
    alive.current = true;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        generation.current++;
        clearFiles();
        setPreview('');
        setOpen(false);
      }
    });
    const invalidate = () => {
      alive.current = false;
      generation.current++;
      clearFiles();
    };
    return () => {
      invalidate();
      sub.remove();
    };
  }, []);
  const take = async () => {
    if (!camera.current || working || !ready) return;
    setWorking(true);
    setError('');
    const epoch = generation.current;
    let saved = '';
    try {
      // Native image reference avoids saving an original full-resolution identity photo to disk.
      const picture = await camera.current.takePictureAsync({ pictureRef: true });
      try {
        const manipulator = ImageManipulator.manipulate(picture);
        try {
          manipulator.resize(
            picture.width >= picture.height
              ? { width: Math.min(1600, picture.width) }
              : { height: Math.min(1600, picture.height) },
          );
          const image = await manipulator.renderAsync();
          try {
            const output = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
            saved = output.uri;
            files.current.add(saved);
            const owned = ownCapture(saved);
            files.current.delete(saved);
            saved = owned;
            files.current.add(saved);
          } finally {
            image.release();
          }
        } finally {
          manipulator.release();
        }
      } finally {
        picture.release();
      }
      if (epoch !== generation.current || !alive.current) return;
      const file = new File(saved);
      if (file.size > 5 * 1024 * 1024) throw new Error('oversized');
      if (reviewBeforeSubmit) {
        pending.current = saved;
        setPreview(saved);
        setOpen(false);
        return;
      }
      const bytes = await file.bytes();
      setOpen(false);
      if (retainPreview) setPreview(saved);
      try {
        await onCapture(bytes);
      } finally {
        bytes.fill(0);
      }
    } catch {
      if (alive.current) setError('Không xử lý được ảnh. Bạn có thể chụp lại hoặc nhập thủ công.');
    } finally {
      if (
        (!retainPreview && pending.current !== saved) ||
        !alive.current ||
        epoch !== generation.current
      ) {
        if (saved) {
          remove(saved);
          files.current.delete(saved);
        }
      }
      if (alive.current) setWorking(false);
    }
  };
  const submitPending = async () => {
    if (!pending.current || working || disabled) return;
    const uri = pending.current;
    const epoch = generation.current;
    setWorking(true);
    try {
      const bytes = await new File(uri).bytes();
      try {
        if (alive.current && epoch === generation.current) await onCapture(bytes);
      } finally {
        bytes.fill(0);
      }
    } catch {
      if (alive.current) setError('Không xử lý được ảnh. Hãy chụp lại hoặc nhập thủ công.');
    } finally {
      remove(uri);
      files.current.delete(uri);
      if (pending.current === uri) pending.current = '';
      if (alive.current) {
        setWorking(false);
        setPreview('');
      }
    }
  };
  return (
    <View style={styles.row}>
      <Button
        mode="outlined"
        disabled={disabled || working}
        loading={working}
        onPress={async () => {
          clearFiles();
          setPreview('');
          setError('');
          const allowed = permission?.granted || (await requestPermission()).granted;
          if (!allowed) {
            setError('Cần cấp quyền camera trong Cài đặt để chụp ảnh. Nhập thủ công vẫn khả dụng.');
            return;
          }
          setReady(false);
          setLens('');
          setLenses([]);
          setZoom(0);
          setCameraGeneration((value) => value + 1);
          setOpen(true);
        }}
      >
        {label}
      </Button>
      {open && (
        <>
          <View style={{ height: 300, overflow: 'hidden', borderRadius: 12 }}>
            <CameraView
              key={`${cameraGeneration}:${lens || 'auto'}`}
              ref={camera}
              style={{ height: 300 }}
              facing="back"
              mode="picture"
              // SDK 58: 'off' means CONTINUOUS auto focus; 'on' focuses once then locks.
              autofocus="off"
              selectedLens={Platform.OS === 'ios' && lens ? lens : undefined}
              zoom={zoom}
              onAvailableLensesChanged={
                Platform.OS === 'ios'
                  ? ({ lenses: reported }) => {
                      setLenses(captureLensOptions(reported));
                    }
                  : undefined
              }
              onCameraReady={() => setReady(true)}
              onMountError={() => {
                setReady(false);
                setError('Không mở được camera. Hãy thử lấy nét lại hoặc đóng rồi mở camera.');
              }}
            />
            {documentSide && (
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 20,
                  right: 20,
                  top: 60,
                  height: 180,
                  borderWidth: 2,
                  borderColor: '#94f5cf',
                  borderRadius: 12,
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  padding: 8,
                }}
              >
                <Text style={{ color: 'white', backgroundColor: '#172b4d', padding: 4 }}>
                  {documentSide === 'front' ? 'MẶT TRƯỚC CCCD' : 'MẶT SAU CCCD'} • Đủ 4 góc
                </Text>
              </View>
            )}
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button mode="contained" disabled={!ready || working} onPress={() => void take()}>
              Chụp ảnh
            </Button>
            <Button disabled={working} onPress={() => setOpen(false)}>
              Hủy chụp
            </Button>
          </View>
          <Text>
            Giữ giấy tờ hoặc mặt số ở giữa khung, đủ sáng. Di chuyển chậm và chờ chữ rõ rồi chụp.
          </Text>
          <Text>
            Nếu đưa gần bị mờ: lùi máy đến khi chữ rõ, rồi dùng Phóng thêm. Không áp sát ống kính.
          </Text>
          {Platform.OS === 'ios' && lenses.length > 0 && (
            <View style={styles.row}>
              <Text variant="titleSmall">Ống kính</Text>
              <SegmentedButtons
                value={lens}
                onValueChange={(value) => {
                  if (value === lens || working) return;
                  setReady(false);
                  setError('');
                  setZoom(0);
                  setLens(value);
                }}
                buttons={[
                  { value: '', label: 'Tự động', disabled: working },
                  ...lenses.map((option) => ({
                    value: option.id,
                    label: option.id.includes('UltraWide') ? 'Siêu rộng' : 'Chính',
                    accessibilityLabel: option.label,
                    disabled: working,
                  })),
                ]}
              />
              {lens.includes('UltraWide') && (
                <Text>Chụp gần còn tùy khả năng camera. Nếu vẫn mờ, hãy lùi máy.</Text>
              )}
            </View>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Button
              disabled={!ready || working || zoom <= 0}
              onPress={() => setZoom((value) => Math.max(0, value - 0.02))}
            >
              Thu bớt
            </Button>
            <Button
              disabled={!ready || working || zoom >= 0.12}
              onPress={() => setZoom((value) => Math.min(0.12, value + 0.02))}
            >
              Phóng thêm
            </Button>
            <Button
              disabled={working}
              onPress={() => {
                setReady(false);
                setError('');
                setCameraGeneration((value) => value + 1);
              }}
            >
              Lấy nét lại
            </Button>
          </View>
          <Text style={styles.note}>
            Phóng ảnh giúp ngắm từ xa hơn; không khôi phục chi tiết của ảnh đã mờ.
          </Text>
        </>
      )}
      {!!preview && (
        <Image
          source={{ uri: preview }}
          resizeMode="contain"
          style={{ width: '100%', height: 200 }}
        />
      )}
      {reviewBeforeSubmit && !!preview && (
        <View style={{ gap: 8 }}>
          <Text>
            Kiểm tra ảnh rõ chữ, không lóa. Ảnh chỉ nằm trong bộ nhớ đệm tạm thời và được xóa sau xử
            lý hoặc khi rời ứng dụng.
          </Text>
          <Button
            mode="contained"
            disabled={disabled || working}
            loading={working}
            onPress={() => void submitPending()}
          >
            Dùng ảnh này để OCR
          </Button>
          <Button
            disabled={working}
            onPress={() => {
              clearFiles();
              setPreview('');
              setReady(false);
              setOpen(true);
            }}
          >
            Chụp lại
          </Button>
          <Button
            disabled={working}
            onPress={() => {
              clearFiles();
              setPreview('');
            }}
          >
            Xóa ảnh tạm
          </Button>
        </View>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}
