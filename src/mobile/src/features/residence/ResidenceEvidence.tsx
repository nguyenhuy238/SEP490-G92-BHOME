import React, { useEffect, useRef, useState } from 'react';
import { Image, Modal, View } from 'react-native';
import { ActivityIndicator, Button, IconButton, Text, TouchableRipple } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  residenceError,
  residenceImageUri,
  type ResidenceClient,
  type ResidenceTask,
} from '../../../../../packages/client-core/src/residence';
import { readResidencePhoto } from '../../services/residencePhoto';

export function ResidenceEvidence({
  api,
  task,
  revision,
  disabled,
  upload,
  reviewRequired,
}: {
  api: ResidenceClient;
  task: ResidenceTask;
  revision: number;
  disabled: boolean;
  upload: (bytes: Uint8Array<ArrayBuffer>) => Promise<boolean>;
  reviewRequired: boolean;
}) {
  const [image, setImage] = useState<{ task: ResidenceTask; uri: string } | null>(null);
  const uri = image?.task === task ? image.uri : '';
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0),
    [large, setLarge] = useState(false);
  const [picked, setPicked] = useState<{ bytes: Uint8Array<ArrayBuffer>; uri: string } | null>(
    null,
  );
  const [picking, setPicking] = useState(false),
    [approved, setApproved] = useState(false);
  const selected = useRef(picked),
    lock = useRef(false),
    alive = useRef(true);
  useEffect(() => {
    selected.current = picked;
  }, [picked]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      selected.current?.bytes.fill(0);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    if (task.hasEvidence)
      void api.image(task, controller.signal).then(
        (bytes) => {
          try {
            if (!controller.signal.aborted) {
              setImage({ task, uri: residenceImageUri(bytes) });
              setError('');
            }
          } catch {
            if (!controller.signal.aborted)
              setError('Không đọc được ảnh minh chứng. Hãy tải lại ảnh.');
          } finally {
            bytes.fill(0);
          }
        },
        (failure) => {
          if (!controller.signal.aborted) setError(residenceError(failure));
        },
      );
    return () => controller.abort();
  }, [api, task, revision, retry]);
  async function pick(camera: boolean) {
    if (lock.current || disabled || (task.ownerConfirmed && !approved)) return;
    lock.current = true;
    setPicking(true);
    setError('');
    try {
      const picker = await import('expo-image-picker');
      if (camera && !(await picker.requestCameraPermissionsAsync()).granted) {
        setError('Chưa có quyền camera. Hãy cấp quyền trong Cài đặt hoặc chọn từ thư viện.');
        return;
      }
      const options = {
        mediaTypes: ['images'] as 'images'[],
        allowsMultipleSelection: false,
        quality: 1,
        exif: false,
        base64: false,
      };
      const result = camera
        ? await picker.launchCameraAsync(options)
        : await picker.launchImageLibraryAsync(options);
      if (result.canceled || !alive.current) return;
      const photo = await readResidencePhoto(result.assets[0]);
      if (!alive.current) {
        photo.bytes.fill(0);
        return;
      }
      selected.current?.bytes.fill(0);
      selected.current = photo;
      setPicked(photo);
    } catch (failure) {
      if (alive.current)
        setError(
          failure instanceof Error && /^(Chỉ nhận|Ảnh cần)/.test(failure.message)
            ? failure.message
            : 'Không mở hoặc đọc được ảnh. Hãy thử lại.',
        );
    } finally {
      lock.current = false;
      if (alive.current) setPicking(false);
    }
  }
  async function save() {
    if (lock.current || disabled || !picked || (task.ownerConfirmed && !approved)) return;
    lock.current = true;
    setPicking(true);
    try {
      if (await upload(picked.bytes)) {
        picked.bytes.fill(0);
        selected.current = null;
        if (alive.current) {
          setPicked(null);
          setApproved(false);
        }
      }
    } finally {
      lock.current = false;
      if (alive.current) setPicking(false);
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <Text variant="titleSmall">Ảnh minh chứng</Text>
      {task.hasEvidence && !uri && !error && <ActivityIndicator size="small" />}
      {!!uri && task.hasEvidence && (
        <TouchableRipple
          accessibilityRole="button"
          accessibilityLabel="Xem ảnh minh chứng"
          onPress={() => setLarge(true)}
        >
          <Image
            source={{ uri }}
            accessibilityLabel="Ảnh minh chứng đã lưu"
            resizeMode="contain"
            style={{ height: 140, width: '100%' }}
          />
        </TouchableRipple>
      )}
      {!task.hasEvidence && <Text>Chưa có ảnh minh chứng</Text>}
      {!!error && (
        <>
          <Text accessibilityRole="alert" style={{ color: '#b42318' }}>
            {error}
          </Text>
          {task.hasEvidence && (
            <Button
              compact
              onPress={() => {
                setError('');
                setRetry((value) => value + 1);
              }}
            >
              Tải lại ảnh
            </Button>
          )}
        </>
      )}
      {task.ownerConfirmed && (
        <>
          <Text variant="bodySmall">
            Thay ảnh sẽ hủy xác nhận Owner hiện tại và cần được xác nhận lại.
          </Text>
          <Button compact disabled={disabled} onPress={() => setApproved(!approved)}>
            {approved ? 'Hủy thay ảnh' : 'Tôi muốn thay ảnh'}
          </Button>
        </>
      )}
      {(!task.ownerConfirmed || approved) && (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button
              compact
              mode="outlined"
              disabled={disabled || picking}
              onPress={() => void pick(true)}
            >
              Chụp ảnh
            </Button>
            <Button
              compact
              mode="outlined"
              disabled={disabled || picking}
              onPress={() => void pick(false)}
            >
              {picked || task.hasEvidence ? 'Thay ảnh' : 'Chọn ảnh'}
            </Button>
          </View>
          {!!picked && (
            <>
              <Image
                source={{ uri: picked.uri }}
                accessibilityLabel="Ảnh đã chọn chưa tải lên"
                resizeMode="contain"
                style={{ height: 140, width: '100%' }}
              />
              <Text variant="bodySmall">Ảnh đã chọn chưa được lưu lên máy chủ.</Text>
              <Button
                mode="contained"
                loading={picking}
                disabled={disabled || picking || reviewRequired}
                onPress={() => void save()}
              >
                Tải ảnh lên
              </Button>
              <Button
                disabled={picking}
                onPress={() => {
                  picked.bytes.fill(0);
                  selected.current = null;
                  setPicked(null);
                }}
              >
                Bỏ ảnh đã chọn
              </Button>
            </>
          )}
        </>
      )}
      <Modal visible={large} onRequestClose={() => setLarge(false)} presentationStyle="fullScreen">
        <SafeAreaView style={{ flex: 1, backgroundColor: 'white' }}>
          <IconButton
            icon="close"
            accessibilityLabel="Đóng ảnh minh chứng"
            onPress={() => setLarge(false)}
          />
          <Image
            source={{ uri }}
            resizeMode="contain"
            accessibilityLabel="Ảnh minh chứng phóng lớn"
            style={{ flex: 1, width: '100%' }}
          />
        </SafeAreaView>
      </Modal>
    </View>
  );
}
