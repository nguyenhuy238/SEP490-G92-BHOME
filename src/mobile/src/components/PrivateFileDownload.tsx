import React, { useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { Text } from 'react-native-paper';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useSession } from '../lib/SessionProvider';
import { randomUUID } from '../lib/randomUUID';
import { lifecycleError } from '../../../../packages/client-core/src/assetLifecycle';
import { Action } from './WorkspaceKit';

export function PrivateFileDownload({
  path,
  contentType,
  label,
}: {
  path: string;
  contentType: string;
  label: string;
}) {
  const { api } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function download() {
    if (!api || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError('');
    let temporary: File | null = null;
    let bytes: Uint8Array | null = null;
    const extension =
      contentType === 'application/pdf' ? 'pdf' : contentType === 'image/png' ? 'png' : 'jpg';
    try {
      if (Platform.OS === 'web') {
        const blob = await api.request<Blob>(path, { signal: controller.signal }, 'blob');
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `tai-lieu.${extension}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else {
        if (!(await Sharing.isAvailableAsync()))
          throw new Error('Thiết bị chưa hỗ trợ mở hoặc lưu tài liệu.');
        bytes = await api.request<Uint8Array>(path, { signal: controller.signal }, 'bytes');
        if (controller.signal.aborted) return;
        const directory = new Directory(Paths.cache, 'bhome-private-downloads');
        directory.create({ idempotent: true, intermediates: true });
        temporary = new File(directory, `${randomUUID()}.${extension}`);
        temporary.create();
        temporary.write(bytes);
        await Sharing.shareAsync(temporary.uri, {
          mimeType: contentType,
          dialogTitle: 'Mở hoặc lưu tài liệu',
        });
      }
    } catch (failure) {
      if (!controller.signal.aborted) setError(lifecycleError(failure));
    } finally {
      bytes?.fill(0);
      if (temporary?.exists) temporary.delete();
      active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <>
      <Action secondary disabled={busy || !api} onPress={() => void download()}>
        {busy ? 'Đang tải tài liệu…' : label}
      </Action>
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
    </>
  );
}
