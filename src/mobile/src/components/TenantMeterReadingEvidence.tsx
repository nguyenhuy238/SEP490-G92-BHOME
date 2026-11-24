import React, { useEffect, useRef, useState } from 'react';
import { Image, Modal, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Icon, Text, TouchableRipple } from 'react-native-paper';
import { useSession } from '../lib/SessionProvider';
import { ocrPreview } from '../lib/automaticOcr';
import { errorMessage } from '../lib/api';
import { colors as c, staffColors as s } from '../theme/theme';

const validReadingId = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

/** Read the authenticated Tenant-only meter photo as bytes on demand. Never build a public photo URL. */
export function TenantMeterReadingEvidence({
  id,
  label = 'Ảnh chỉ số đồng hồ',
  compact = false,
}: {
  id: string;
  label?: string;
  compact?: boolean;
}) {
  const { api, session } = useSession();
  const [image, setImage] = useState<{ id: string; actor: string; uri: string } | null>(null);
  const [failure, setFailure] = useState<{ id: string; actor: string; message: string } | null>(
    null,
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      pending.current?.abort();
      pending.current = null;
    },
    [id, api, session?.userId],
  );

  // The image is never displayed under a different reading if the component
  // is reused for a new ID while an old request is still in flight.
  const uri = image?.id === id && image.actor === session?.userId ? image.uri : '';
  const error = failure?.id === id && failure.actor === session?.userId ? failure.message : '';
  const requestKey = `${session?.userId ?? ''}:${id}`;
  const busy = busyKey === requestKey;

  const permitted =
    !!api && !!session?.userId && !!session.roles.includes('Tenant') && validReadingId.test(id);
  async function load() {
    if (!permitted || !api || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusyKey(requestKey);
    setFailure(null);
    try {
      const bytes = await api.request<Uint8Array>(
        `/api/v1/tenant/meter-readings/${encodeURIComponent(id)}/evidence`,
        { signal: controller.signal },
        'bytes',
      );
      try {
        const png =
          bytes.length >= 8 &&
          bytes[0] === 137 &&
          bytes[1] === 80 &&
          bytes[2] === 78 &&
          bytes[3] === 71 &&
          bytes[4] === 13 &&
          bytes[5] === 10 &&
          bytes[6] === 26 &&
          bytes[7] === 10;
        const jpeg = bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
        if (bytes.length > 5 * 1024 * 1024 || !(png || jpeg))
          throw new Error('Ảnh không hợp lệ. Vui lòng liên hệ quản lý phòng.');
        if (!controller.signal.aborted && session?.userId)
          setImage({ id, actor: session.userId, uri: ocrPreview(bytes) });
      } finally {
        bytes.fill(0);
      }
    } catch (cause) {
      if (!controller.signal.aborted && session?.userId)
        setFailure({ id, actor: session.userId, message: errorMessage(cause) });
    } finally {
      if (pending.current === controller) pending.current = null;
      if (!controller.signal.aborted) setBusyKey(null);
    }
  }

  if (!permitted) return null;
  return (
    <View style={styles.root}>
      <TouchableRipple
        onPress={() => (uri ? setImage(null) : void load())}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={`${uri ? 'Ẩn' : 'Xem'} ${label.toLocaleLowerCase('vi-VN')}`}
        style={styles.trigger}
      >
        <View style={styles.control}>
          {busy ? (
            <ActivityIndicator size="small" />
          ) : (
            <Icon source={uri ? 'eye-off-outline' : 'image-outline'} size={18} color={s.blue} />
          )}
          <Text style={styles.action}>
            {busy ? 'Đang tải ảnh…' : uri ? 'Ẩn ảnh' : compact ? 'Xem ảnh' : label}
          </Text>
        </View>
      </TouchableRipple>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {!!uri &&
        (compact ? (
          <Modal transparent visible animationType="fade" onRequestClose={() => setImage(null)}>
            <View style={styles.imageOverlay}>
              <TouchableRipple
                accessibilityRole="button"
                accessibilityLabel="Đóng ảnh bằng chứng"
                style={styles.closePhoto}
                onPress={() => setImage(null)}
              >
                <View style={styles.closePhotoContents}>
                  <Icon source="close" size={20} color={c.white} />
                  <Text style={styles.closePhotoText}>Đóng ảnh</Text>
                </View>
              </TouchableRipple>
              <Image
                source={{ uri }}
                resizeMode="contain"
                style={styles.largePreview}
                accessibilityLabel={label}
              />
            </View>
          </Modal>
        ) : (
          <Image
            source={{ uri }}
            resizeMode="contain"
            style={styles.preview}
            accessibilityLabel={label}
          />
        ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: 8, minWidth: 0 },
  trigger: { alignSelf: 'flex-start', borderRadius: 10, minHeight: 44, justifyContent: 'center' },
  control: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 8,
    paddingHorizontal: 2,
  },
  action: { color: s.blue, fontSize: 13, fontWeight: '600' },
  preview: { width: '100%', height: 200, backgroundColor: '#F5F7FB', borderRadius: 12 },
  imageOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.95)',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 28,
  },
  largePreview: { width: '100%', height: '82%' },
  closePhoto: { alignSelf: 'flex-end', borderRadius: 10, minWidth: 96, minHeight: 48 },
  closePhotoContents: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    paddingHorizontal: 8,
  },
  closePhotoText: { color: c.white, fontSize: 14, fontWeight: '600' },
  error: { color: c.red, fontSize: 12 },
});
