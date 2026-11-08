import { useFeedbackState } from '../lib/useFeedbackState';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Platform, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Button, SegmentedButtons, Text } from 'react-native-paper';
import { styles } from './Controls';
import { ownCapture } from '../lib/captureFiles';
import { captureLensOptions } from '../lib/captureLenses';
import { DocumentCameraView } from './DocumentCameraView';
import { MeterCameraView } from './MeterCameraView';
import { TaskEvidenceCameraView } from './TaskEvidenceCameraView';
import { useFocusEffect } from 'expo-router';

// Only URIs created by this component in the application's cache are accepted for deletion.
function remove(uri: string) {
  if (uri.startsWith(Paths.cache.uri)) {
    const f = new File(uri);
    if (f.exists) f.delete();
  }
}
export function CameraCapture({
  label,
  buttonMode = 'outlined',
  disabled,
  onCapture,
  retainPreview = false,
  reviewBeforeSubmit = false,
  reviewActionLabel = 'Dùng ảnh này để OCR',
  reviewNotice = 'Kiểm tra ảnh rõ chữ, không lóa. Ảnh chỉ nằm trong bộ nhớ đệm tạm thời và được xóa sau xử lý hoặc khi rời ứng dụng.',
  documentSide,
  presentation = 'inline',
  onManual,
  onPhotoCaptured,
  onPhotoCleared,
  meterStep = 1,
  autoOpen = false,
  captureInstruction,
  retryOnly = false,
  uploadError = '',
}: {
  label: string;
  buttonMode?: 'outlined' | 'contained';
  disabled: boolean;
  onCapture: (bytes: Uint8Array<ArrayBuffer>) => Promise<void | boolean>;
  retainPreview?: boolean;
  reviewBeforeSubmit?: boolean;
  reviewActionLabel?: string;
  reviewNotice?: string;
  documentSide?: 'front' | 'back';
  presentation?: 'inline' | 'document' | 'meter' | 'evidence';
  retryOnly?: boolean;
  uploadError?: string;
  meterStep?: number;
  autoOpen?: boolean;
  captureInstruction?: string;
  onManual?: () => void;
  onPhotoCaptured?: () => void;
  onPhotoCleared?: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [open, setOpen] = useState(false);
  const [evidenceVisible, setEvidenceVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useFeedbackState();
  const [lens, setLens] = useState('');
  const [lenses, setLenses] = useState<{ id: string; label: string }[]>([]);
  const [zoom, setZoom] = useState(0);
  const [cameraGeneration, setCameraGeneration] = useState(0);
  const files = useRef(new Set<string>());
  const pending = useRef('');
  const alive = useRef(true);
  const generation = useRef(0);
  const workingLock = useRef(false);
  const permissionLock = useRef(false);
  const permissionAccess = useRef({ permission, requestPermission });
  const clearCallback = useRef(onPhotoCleared);
  useEffect(() => {
    clearCallback.current = onPhotoCleared;
  }, [onPhotoCleared]);
  const [requestingPermission, setRequestingPermission] = useState(false);
  useEffect(() => {
    permissionAccess.current = { permission, requestPermission };
  }, [permission, requestPermission]);
  const clearFiles = useCallback(() => {
    for (const uri of files.current) remove(uri);
    files.current.clear();
    pending.current = '';
    clearCallback.current?.();
  }, []);
  useFocusEffect(
    useCallback(
      () => () => {
        if (presentation !== 'meter' && presentation !== 'evidence') return;
        generation.current++;
        clearFiles();
        setPreview('');
        setOpen(false);
        setEvidenceVisible(false);
      },
      [clearFiles, presentation],
    ),
  );
  const openCamera = useCallback(async () => {
    if (permissionLock.current || workingLock.current) return;
    permissionLock.current = true;
    const epoch = ++generation.current;
    clearFiles();
    setPreview('');
    setError('');
    setReady(false);
    if (presentation === 'evidence') setEvidenceVisible(true);
    setRequestingPermission(true);
    try {
      const access = permissionAccess.current;
      const allowed = access.permission?.granted || (await access.requestPermission()).granted;
      if (!alive.current || epoch !== generation.current) return;
      if (!allowed) {
        setError(
          presentation === 'meter' || presentation === 'evidence'
            ? 'Cần cấp quyền camera trong Cài đặt để chụp ảnh.'
            : 'Cần cấp quyền camera trong Cài đặt để chụp ảnh. Nhập thủ công vẫn khả dụng.',
        );
        return;
      }
      setLens('');
      setLenses([]);
      setZoom(0);
      setCameraGeneration((value) => value + 1);
      setOpen(true);
    } catch {
      if (alive.current && epoch === generation.current)
        setError(
          presentation === 'meter' || presentation === 'evidence'
            ? 'Không mở được camera. Hãy thử lại.'
            : 'Không mở được camera. Bạn có thể thử lại hoặc nhập thủ công.',
        );
    } finally {
      permissionLock.current = false;
      if (alive.current) setRequestingPermission(false);
    }
  }, [clearFiles, setError, presentation]);
  useEffect(() => {
    alive.current = true;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        generation.current++;
        clearFiles();
        setPreview('');
        setOpen(false);
        setEvidenceVisible(false);
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
  }, [clearFiles]);
  useEffect(() => {
    if (presentation !== 'document' && !(presentation === 'meter' && autoOpen)) return;
    // Let the modal mount before requesting the native camera permission/view.
    const start = setTimeout(() => void openCamera(), 0);
    return () => clearTimeout(start);
  }, [presentation, openCamera, autoOpen]);
  const take = async () => {
    if (!camera.current || workingLock.current || disabled || !ready) return;
    workingLock.current = true;
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
      if (reviewBeforeSubmit || presentation === 'evidence') {
        pending.current = saved;
        setPreview(saved);
        setOpen(false);
        onPhotoCaptured?.();
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
      if (alive.current)
        setError(
          presentation === 'meter' || presentation === 'evidence'
            ? 'Không xử lý được ảnh. Hãy chụp lại.'
            : 'Không xử lý được ảnh. Bạn có thể chụp lại hoặc nhập thủ công.',
        );
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
      workingLock.current = false;
    }
  };
  const submitPending = async () => {
    if (!pending.current || workingLock.current || disabled) return;
    workingLock.current = true;
    const uri = pending.current;
    const epoch = generation.current;
    setWorking(true);
    setError('');
    let confirmed = false;
    try {
      const bytes = await new File(uri).bytes();
      try {
        if (alive.current && epoch === generation.current) {
          const result = await onCapture(bytes);
          confirmed = result !== false;
        }
      } finally {
        bytes.fill(0);
      }
    } catch {
      if (alive.current)
        setError(
          presentation === 'evidence'
            ? 'Chưa tải được ảnh. Hãy thử lại.'
            : presentation === 'meter'
              ? 'Không xử lý được ảnh. Hãy chụp lại.'
              : 'Không xử lý được ảnh. Hãy chụp lại hoặc nhập thủ công.',
        );
    } finally {
      // Meter evidence stays available for review/retry; identity captures keep their
      // existing immediate cleanup behavior. All captures are removed on exit/background.
      const keep =
        (retainPreview || (presentation === 'evidence' && !confirmed)) &&
        alive.current &&
        epoch === generation.current;
      if (!keep) {
        remove(uri);
        files.current.delete(uri);
        if (pending.current === uri) pending.current = '';
      }
      if (alive.current) {
        setWorking(false);
        if (!keep) setPreview('');
        if (presentation === 'evidence' && confirmed) setEvidenceVisible(false);
      }
      workingLock.current = false;
    }
  };
  if (presentation === 'evidence') {
    const close = () => {
      if (workingLock.current) return;
      generation.current++;
      clearFiles();
      setPreview('');
      setReady(false);
      setOpen(false);
      setEvidenceVisible(false);
      setError('');
    };
    return (
      <>
        <Button
          mode={buttonMode}
          disabled={disabled || working || retryOnly}
          onPress={() => void openCamera()}
        >
          {label}
        </Button>
        <TaskEvidenceCameraView
          visible={evidenceVisible}
          camera={
            evidenceVisible && open && !preview ? (
              <CameraView
                ref={camera}
                key={cameraGeneration}
                style={{ flex: 1 }}
                facing="back"
                mode="picture"
                autofocus="off"
                onCameraReady={() => setReady(true)}
                onMountError={() => {
                  setOpen(false);
                  setReady(false);
                  setError('Không mở được camera. Hãy thử lại.');
                }}
              />
            ) : null
          }
          preview={preview}
          working={working || requestingPermission}
          ready={ready}
          disabled={disabled}
          retryOnly={retryOnly}
          error={uploadError || error}
          onClose={close}
          onTake={() => void take()}
          onUse={() => void submitPending()}
          onOpen={() => void openCamera()}
          onRetake={() => {
            clearFiles();
            setPreview('');
            setReady(false);
            setError('');
            setOpen(true);
          }}
        />
      </>
    );
  }
  if (presentation === 'meter')
    return (
      <MeterCameraView
        camera={
          open ? (
            <CameraView
              ref={camera}
              key={cameraGeneration}
              style={{ flex: 1 }}
              facing="back"
              mode="picture"
              autofocus="off"
              onCameraReady={() => setReady(true)}
              onMountError={() => {
                setOpen(false);
                setReady(false);
                setError('Không mở được camera. Hãy thử lại.');
              }}
            />
          ) : null
        }
        label={label}
        step={meterStep}
        preview={preview}
        disabled={disabled}
        working={working}
        ready={ready}
        requestingPermission={requestingPermission}
        error={error}
        onOpen={() => void openCamera()}
        onTake={() => void take()}
        onClose={() => setOpen(false)}
        onUse={() => void submitPending()}
        onRetake={() => {
          clearFiles();
          setPreview('');
          setReady(false);
          setOpen(true);
        }}
      />
    );
  if (presentation === 'document')
    return (
      <DocumentCameraView
        camera={
          open && !preview ? (
            <CameraView
              ref={camera}
              key={cameraGeneration}
              style={{ flex: 1 }}
              facing="back"
              mode="picture"
              autofocus="off"
              onCameraReady={() => setReady(true)}
              onMountError={() => {
                setOpen(false);
                setReady(false);
                setError('Không mở được camera. Hãy thử lại hoặc nhập thủ công.');
              }}
            />
          ) : null
        }
        preview={preview}
        documentSide={documentSide}
        working={working}
        disabled={disabled}
        ready={ready && open}
        requestingPermission={requestingPermission}
        error={error}
        onTake={() => void take()}
        onUse={() => void submitPending()}
        onRetake={() => {
          clearFiles();
          setPreview('');
          setReady(false);
          setOpen(true);
        }}
        onRequestPermission={() => void openCamera()}
        onManual={() => {
          clearFiles();
          onManual?.();
        }}
      />
    );
  return (
    <View style={styles.row}>
      <Button
        mode={buttonMode}
        disabled={disabled || working}
        loading={working}
        onPress={() => void openCamera()}
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
                  {documentSide === 'front' ? 'MẶT TRƯỚC CCCD' : 'MẶT SAU CCCD'} • Căn giấy tờ trong
                  khung
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
            {captureInstruction ??
              'Giữ giấy tờ hoặc mặt số ở giữa khung, đủ sáng. Di chuyển chậm và chờ chữ rõ rồi chụp.'}
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
          accessibilityLabel="Ảnh vừa chụp"
          source={{ uri: preview }}
          resizeMode="contain"
          style={{ width: '100%', height: 200 }}
        />
      )}
      {reviewBeforeSubmit && !!preview && (
        <View style={{ gap: 8 }}>
          <Text>{reviewNotice}</Text>
          <Button
            mode="contained"
            disabled={disabled || working}
            loading={working}
            onPress={() => void submitPending()}
          >
            {reviewActionLabel}
          </Button>
          <Button
            disabled={disabled || working}
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
            disabled={disabled || working}
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
