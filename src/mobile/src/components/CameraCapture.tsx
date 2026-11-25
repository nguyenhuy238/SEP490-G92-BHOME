import { useFeedbackState } from '../lib/useFeedbackState';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Image, Platform, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { File, Paths } from 'expo-file-system';
import { Button, Text } from 'react-native-paper';
import { styles } from './Controls';
import { prepareCapture } from '../lib/prepareCapture';
import { LiveCaptureCamera } from './LiveCaptureCamera';
import { DocumentCameraGuide, DocumentCameraView } from './DocumentCameraView';
import { MeterCameraView } from './MeterCameraView';
import { TaskEvidenceCameraView } from './TaskEvidenceCameraView';
import { useFocusEffect } from 'expo-router';
import {
  canUseLocalMeterDemo,
  createMeterDemoJpeg,
  meterDemoJpegBytes,
} from '../lib/meterDemoCapture';

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
  meterCompact = false,
  meterRetryResets = false,
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
  meterCompact?: boolean;
  meterRetryResets?: boolean;
  autoOpen?: boolean;
  captureInstruction?: string;
  onManual?: () => void;
  onPhotoCaptured?: () => void;
  onPhotoCleared?: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [open, setOpen] = useState(false);
  const [session, setSession] = useState(0);
  const [evidenceVisible, setEvidenceVisible] = useState(false);
  const [ready, setReady] = useState(false);
  const [working, setWorking] = useState(false);
  const [preview, setPreview] = useState('');
  const [error, setError] = useFeedbackState();
  const files = useRef(new Set<string>());
  const pending = useRef('');
  const alive = useRef(true);
  const generation = useRef(0);
  const workingLock = useRef(false);
  const permissionLock = useRef(false);
  const readyAccess = useRef(false);
  const active = useRef(true);
  const pendingOpen = useRef<number | null>(null);
  const permissionAccess = useRef({ permission, requestPermission });
  const clearCallback = useRef(onPhotoCleared);
  useEffect(() => {
    clearCallback.current = onPhotoCleared;
  }, [onPhotoCleared]);
  const [requestingPermission, setRequestingPermission] = useState(false);
  const localMeterDemo =
    presentation === 'meter' &&
    canUseLocalMeterDemo(
      typeof __DEV__ !== 'undefined' && __DEV__,
      Platform.OS,
      globalThis.location?.hostname,
      globalThis.location?.port,
    );
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
        generation.current++;
        readyAccess.current = false;
        setReady(false);
        clearFiles();
        setPreview('');
        setOpen(false);
        setEvidenceVisible(false);
      },
      [clearFiles],
    ),
  );
  const openCamera = useCallback(async () => {
    if (permissionLock.current || workingLock.current) return;
    permissionLock.current = true;
    const epoch = ++generation.current;
    clearFiles();
    setPreview('');
    setError('');
    readyAccess.current = false;
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
      setSession(epoch);
      if (active.current) setOpen(true);
      else pendingOpen.current = epoch;
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
      active.current = state === 'active';
      if (state === 'active' && pendingOpen.current === generation.current) {
        pendingOpen.current = null;
        setOpen(true);
      }
      // Permission dialogs can inactivate the app before a camera has opened.
      if (state === 'background' || (state !== 'active' && !permissionLock.current)) {
        generation.current++;
        pendingOpen.current = null;
        readyAccess.current = false;
        setReady(false);
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
    // Local Web testers must be able to choose the demo photo without a camera
    // permission prompt racing with/clearing the generated preview.
    if (presentation !== 'document' && !(presentation === 'meter' && autoOpen && !localMeterDemo))
      return;
    // Let the modal mount before requesting the native camera permission/view.
    const start = setTimeout(() => void openCamera(), 0);
    return () => clearTimeout(start);
  }, [presentation, openCamera, autoOpen, localMeterDemo]);
  const take = async () => {
    if (!camera.current || workingLock.current || disabled || !readyAccess.current) return;
    workingLock.current = true;
    setWorking(true);
    setError('');
    const epoch = generation.current;
    let saved = '';
    try {
      // Native image reference avoids saving an original full-resolution identity photo to disk.
      const picture = await camera.current.takePictureAsync({ pictureRef: true });
      try {
        saved = await prepareCapture(
          picture,
          () => alive.current && epoch === generation.current,
          presentation === 'evidence',
        );
        files.current.add(saved);
      } finally {
        picture.release();
      }
      if (epoch !== generation.current || !alive.current) return;
      const file = new File(saved);
      if (reviewBeforeSubmit || presentation === 'evidence') {
        pending.current = saved;
        setPreview(saved);
        setOpen(false);
        onPhotoCaptured?.();
        return;
      }
      const bytes = await file.bytes();
      try {
        if (!alive.current || epoch !== generation.current) return;
        setOpen(false);
        if (retainPreview) setPreview(saved);
        await onCapture(bytes);
      } finally {
        bytes.fill(0);
      }
    } catch {
      if (alive.current && epoch === generation.current)
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
      const bytes = uri.startsWith('data:image/jpeg;base64,')
        ? meterDemoJpegBytes(uri)
        : await new File(uri).bytes();
      try {
        if (alive.current && epoch === generation.current) {
          const result = await onCapture(bytes);
          confirmed = result !== false;
        }
      } finally {
        bytes.fill(0);
      }
    } catch {
      if (alive.current && epoch === generation.current)
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
      if (alive.current && epoch === generation.current) {
        if (!keep) setPreview('');
        if (presentation === 'evidence' && confirmed) setEvidenceVisible(false);
      }
      if (alive.current) setWorking(false);
      workingLock.current = false;
    }
  };
  const liveCamera =
    open && !preview ? (
      <LiveCaptureCamera
        key={session}
        camera={camera}
        disabled={disabled || working}
        dark={presentation === 'document'}
        showControls={presentation !== 'evidence'}
        onReady={(value) => {
          if (!alive.current || generation.current !== session) return;
          readyAccess.current = value;
          setReady(value);
        }}
        onError={() => {
          if (!alive.current || generation.current !== session) return;
          setOpen(false);
          setError('Không mở được camera. Hãy thử lại.');
        }}
      >
        {presentation === 'document' && <DocumentCameraGuide />}
      </LiveCaptureCamera>
    ) : null;
  const closeCamera = () => {
    generation.current++;
    pendingOpen.current = null;
    readyAccess.current = false;
    setReady(false);
    setOpen(false);
  };
  const resetCapture = () => {
    closeCamera();
    clearFiles();
    setPreview('');
    setError('');
  };
  const retake = () => {
    resetCapture();
    setSession(generation.current);
    setOpen(true);
  };
  const selectDemoMeterPhoto = async () => {
    if (!localMeterDemo || disabled || workingLock.current) return;
    workingLock.current = true;
    setWorking(true);
    setError('');
    let bytes: Uint8Array<ArrayBuffer> | null = null;
    try {
      const uri = createMeterDemoJpeg();
      bytes = meterDemoJpegBytes(uri);
      closeCamera();
      clearFiles();
      setPreview(uri);
      pending.current = uri;
      onPhotoCaptured?.();
      await onCapture(bytes);
    } catch {
      if (alive.current) setError('Không tạo hoặc xử lý được ảnh mẫu. Hãy thử lại.');
    } finally {
      bytes?.fill(0);
      workingLock.current = false;
      if (alive.current) setWorking(false);
    }
  };
  if (presentation === 'evidence') {
    const close = () => {
      if (workingLock.current) return;
      closeCamera();
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
          camera={liveCamera}
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
          onRetake={retake}
        />
      </>
    );
  }
  if (presentation === 'meter')
    return (
      <MeterCameraView
        camera={liveCamera}
        label={label}
        step={meterStep}
        compact={meterCompact}
        preview={preview}
        disabled={disabled}
        working={working}
        ready={ready}
        requestingPermission={requestingPermission}
        error={error}
        onOpen={() => void openCamera()}
        onTake={() => void take()}
        onClose={closeCamera}
        onUse={() => void submitPending()}
        onRetake={retake}
        onRetry={meterRetryResets ? resetCapture : undefined}
        onUseDemo={localMeterDemo && !preview ? () => void selectDemoMeterPhoto() : undefined}
      />
    );
  if (presentation === 'document')
    return (
      <DocumentCameraView
        camera={liveCamera}
        preview={preview}
        documentSide={documentSide}
        working={working}
        disabled={disabled}
        ready={ready && open}
        requestingPermission={requestingPermission}
        error={error}
        onTake={() => void take()}
        onUse={() => void submitPending()}
        onRetake={retake}
        onRequestPermission={() => void openCamera()}
        onManual={() => {
          closeCamera();
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
          <View style={{ height: 460, overflow: 'hidden', borderRadius: 12 }}>
            {liveCamera}
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
            <Button disabled={working} onPress={closeCamera}>
              Hủy chụp
            </Button>
          </View>
          <Text>
            {captureInstruction ??
              'Giữ giấy tờ hoặc mặt số ở giữa khung, đủ sáng. Di chuyển chậm và chờ chữ rõ rồi chụp.'}
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
          <Button disabled={disabled || working} onPress={retake}>
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
