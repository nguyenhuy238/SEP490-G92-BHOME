import React, { useEffect, useState } from 'react';
import { Image, View } from 'react-native';
import { ActivityIndicator, Button, Text } from 'react-native-paper';
import { useSession } from '../lib/SessionProvider';
import { ocrPreview } from '../lib/automaticOcr';
import { errorMessage } from '../lib/api';
import { meterService } from '../services/meterService';

/** Display the persisted private photo for a confirmed Staff reading. */
export function StaffMeterReadingEvidence({ id, label }: { id: string; label: string }) {
  const { api, session } = useSession();
  const actor = session?.userId;
  const permitted = !!api && !!actor && !!session?.roles.includes('Staff');
  const [revision, setRevision] = useState(0);
  const key = `${actor}:${id}:${revision}`;
  const [result, setResult] = useState<{
    key: string;
    api: typeof api;
    uri?: string;
    error?: string;
  } | null>(null);
  const visible = result?.key === key && result.api === api ? result : null;

  useEffect(() => {
    if (!api || !permitted) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const bytes = await meterService(api).evidence(id, controller.signal);
        try {
          const png = [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte);
          const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
          if (bytes.length > 5 * 1024 * 1024 || !(png || jpeg))
            throw new Error('Ảnh minh chứng không phải PNG/JPEG hợp lệ.');
          if (!controller.signal.aborted) setResult({ key, api, uri: ocrPreview(bytes) });
        } finally {
          bytes.fill(0);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setResult({ key, api, error: errorMessage(cause) });
      }
    })();
    return () => controller.abort();
  }, [api, id, key, permitted]);

  if (!permitted) return null;
  return (
    <View style={{ gap: 6 }}>
      <Text variant="labelLarge">{label}</Text>
      {visible?.uri ? (
        <Image
          source={{ uri: visible.uri }}
          resizeMode="contain"
          accessibilityLabel={label}
          style={{ width: '100%', height: 220, borderRadius: 10 }}
          onError={() => setResult({ key, api, error: 'Không thể hiển thị ảnh minh chứng.' })}
        />
      ) : visible?.error ? (
        <>
          <Text accessibilityRole="alert">Không tải được ảnh minh chứng. {visible.error}</Text>
          <Button onPress={() => setRevision((value) => value + 1)}>Thử tải lại ảnh</Button>
        </>
      ) : (
        <ActivityIndicator accessibilityLabel="Đang tải ảnh minh chứng" />
      )}
    </View>
  );
}
