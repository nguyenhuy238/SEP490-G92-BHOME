import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { Button, Checkbox, Text } from 'react-native-paper';
import {
  boxHeight,
  clampPlacement,
  signingError,
  type SignatureImageView,
  type SignaturePlacement,
  type SigningClient,
  type SigningLayout,
} from '../../../../../packages/client-core/src/signing';
import { ocrPreview } from '../../lib/automaticOcr';
import { Action, Box, ui } from '../../components/WorkspaceKit';
import { ChoiceField, Input } from '../../components/WorkflowControls';

export interface PlacementChoice {
  placement: SignaturePlacement | null;
  usePicture: boolean;
}

// Loads `load` whenever `id` changes and keeps only the answer for the current `id`.
function useLoad<T>(id: string, load: ((signal: AbortSignal) => Promise<T>) | null) {
  const [state, setState] = useState<{ id: string; value?: T; error?: string } | null>(null);
  const [revision, setRevision] = useState(0);
  const enabled = !!load;
  useEffect(() => {
    if (!load) return;
    const controller = new AbortController();
    Promise.resolve()
      .then(() => load(controller.signal))
      .then(
        (value) => !controller.signal.aborted && setState({ id, value }),
        (e: unknown) => !controller.signal.aborted && setState({ id, error: signingError(e) }),
      );
    return () => controller.abort();
    // `load` is a new closure every render; `id` names what it loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, enabled, revision]);
  const current = enabled && state?.id === id ? state : null;
  return {
    value: current?.value,
    error: current?.error ?? '',
    loading: enabled && !current,
    reload: () => setRevision((r) => r + 1),
  };
}

// The contract page with the signer's box on it: drag the box to move it, use the buttons to resize it or change
// page. Starts in the signer's own box of the contract's signature block.
export function SignaturePlacementField({
  signing,
  contractId,
  value,
  onChange,
  disabled,
}: {
  signing: SigningClient;
  contractId: string;
  value: PlacementChoice;
  onChange: (value: PlacementChoice) => void;
  disabled?: boolean;
}) {
  const layout = useLoad<SigningLayout>('layout:' + contractId, async (signal) => {
    const data = await signing.layout(contractId, signal);
    if (!Array.isArray(data?.pages) || !data.pages.length || data.pageCount !== data.pages.length)
      throw new Error('Không đọc được các trang của hợp đồng.');
    return data;
  });
  const picture = useLoad<SignatureImageView>('picture', (signal) => signing.image(signal));
  const shownPicture = picture.value?.present ? picture.value : null;
  const pictureUri = useLoad<string>(
    'picture-content:' + (shownPicture?.version ?? ''),
    shownPicture ? async (signal) => ocrPreview(await signing.imageBytes(signal)) : null,
  );
  const data = layout.value;
  const pages = useMemo(() => data?.pages ?? [], [data]);
  const page = value.placement?.page ?? data?.suggested?.page ?? data?.pageCount ?? 1;
  const pageUri = useLoad<string>(
    `page:${contractId}:${page}`,
    data
      ? async (signal) => ocrPreview(await signing.pageBytes(contractId, page, 800, signal))
      : null,
  );
  const [width, setWidth] = useState(0);
  const size = pages[page - 1] ?? { width: 595, height: 842 };
  const height = width * (size.height / size.width);
  useEffect(() => {
    if (!data || value.placement) return;
    const start = data.suggested ?? { page: data.pageCount, x: 0.55, y: 0.7, width: 0.35 };
    onChange({
      placement: clampPlacement(start, data.pages, shownPicture, value.usePicture),
      usePicture: value.usePicture && data.hasPicture,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const set = (next: Partial<SignaturePlacement>, usePicture = value.usePicture) => {
    if (!value.placement) return;
    onChange({
      placement: clampPlacement({ ...value.placement, ...next }, pages, shownPicture, usePicture),
      usePicture,
    });
  };
  // Gesture responder: remember where the finger and the box were when the drag began.
  const drag = useRef<{ pageX: number; pageY: number; from: SignaturePlacement } | null>(null);
  const handlers = {
    onStartShouldSetResponder: () => !disabled,
    onMoveShouldSetResponder: () => !disabled,
    onResponderGrant: (e: GestureResponderEvent) => {
      if (value.placement)
        drag.current = {
          pageX: e.nativeEvent.pageX,
          pageY: e.nativeEvent.pageY,
          from: value.placement,
        };
    },
    onResponderMove: (e: GestureResponderEvent) => {
      const d = drag.current;
      if (!d || !width || !height) return;
      set({
        x: d.from.x + (e.nativeEvent.pageX - d.pageX) / width,
        y: d.from.y + (e.nativeEvent.pageY - d.pageY) / height,
      });
    },
    onResponderRelease: () => (drag.current = null),
    onResponderTerminate: () => (drag.current = null),
  };

  if (layout.loading) return <Text>Đang tải trang hợp đồng…</Text>;
  if (layout.error)
    return (
      <>
        <Text style={ui.red}>
          {layout.error} Nếu vẫn gửi, chữ ký đặt vào ô ký mặc định của bạn.
        </Text>
        <Button onPress={layout.reload}>Tải lại trang</Button>
      </>
    );
  if (!data || !value.placement) return null;
  const p = value.placement;
  const box = boxHeight(p.width, size, shownPicture, value.usePicture);
  return (
    <Box>
      <Text variant="titleSmall">Vị trí chữ ký trên hợp đồng</Text>
      <Text variant="bodySmall">
        Kéo ô màu xanh tới chỗ muốn ký. Mặc định là ô{' '}
        {data.party === 'Owner' ? 'Bên A (Chủ nhà)' : 'Bên B (Người thuê)'} ở cuối hợp đồng.
      </Text>
      {data.pageCount > 1 && (
        <ChoiceField
          label="Trang"
          value={String(p.page)}
          disabled={disabled}
          options={pages.map((_, i) => ({ id: String(i + 1), label: `Trang ${i + 1}` }))}
          onChange={(v) => set({ page: Number(v) })}
        />
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' }}>
        <Button disabled={disabled} onPress={() => set({ width: p.width - 0.05 })}>
          Thu nhỏ
        </Button>
        <Button disabled={disabled} onPress={() => set({ width: p.width + 0.05 })}>
          Phóng to
        </Button>
        {data.suggested && (
          <Button
            disabled={disabled}
            onPress={() =>
              onChange({
                placement: clampPlacement(data.suggested!, pages, shownPicture, value.usePicture),
                usePicture: value.usePicture,
              })
            }
          >
            Về ô ký mặc định
          </Button>
        )}
      </View>
      <Checkbox.Item
        label={
          shownPicture
            ? 'Hiển thị ảnh chữ ký của tôi trong ô ký'
            : 'Chưa có ảnh chữ ký: ô ký chỉ ghi "Ký bởi / Ngày ký"'
        }
        disabled={disabled || !shownPicture}
        status={value.usePicture && shownPicture ? 'checked' : 'unchecked'}
        onPress={() => set({}, !value.usePicture)}
      />
      <View
        accessibilityLabel={`Trang ${p.page} của hợp đồng`}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        style={{
          width: '100%',
          height: height || 300,
          backgroundColor: '#eee',
          borderWidth: 1,
          borderColor: '#ccc',
        }}
      >
        {!!pageUri.value && (
          <Image
            source={{ uri: pageUri.value }}
            style={{ position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' }}
            resizeMode="stretch"
          />
        )}
        {pageUri.loading && <Text style={{ padding: 8 }}>Đang tải trang…</Text>}
        <View
          {...handlers}
          accessibilityLabel="Ô chữ ký"
          style={{
            position: 'absolute',
            left: p.x * width,
            top: p.y * height,
            width: p.width * width,
            height: box * height,
            borderWidth: 2,
            borderColor: '#1976d2',
            backgroundColor: 'rgba(25,118,210,0.08)',
            padding: 2,
            overflow: 'hidden',
          }}
        >
          {value.usePicture && shownPicture && !!pictureUri.value && (
            <Image
              source={{ uri: pictureUri.value }}
              style={{ width: '100%', aspectRatio: shownPicture.width / shownPicture.height }}
              resizeMode="contain"
            />
          )}
          <Text style={{ color: '#c62828', fontSize: 8, lineHeight: 10 }}>
            Ký bởi: {data.signerName || 'tên trên chứng thư'}
            {'\n'}Ngày ký: lúc xác nhận trên MySign
          </Text>
        </View>
      </View>
    </Box>
  );
}

// "Ảnh chữ ký": shown above "Ký bởi / Ngày ký" in the signer's box. On mobile it is generated from the signer's
// name; a scanned PNG can be uploaded from the Owner portal.
export function SignatureImageSection({ signing }: { signing: SigningClient }) {
  const [revision, setRevision] = useState(0);
  const view = useLoad<SignatureImageView>('picture:' + revision, (signal) =>
    signing.image(signal),
  );
  const uri = useLoad<string>(
    'picture-content:' + (view.value?.present ? view.value.version : ''),
    view.value?.present ? async (signal) => ocrPreview(await signing.imageBytes(signal)) : null,
  );
  const [name, setName] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  async function run(work: () => Promise<unknown>, message: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await work();
      setNotice(message);
    } catch (e) {
      setError(signingError(e));
    } finally {
      setBusy(false);
      setRevision((r) => r + 1);
    }
  }
  return (
    <Box>
      <Text variant="titleSmall">Ảnh chữ ký của bạn</Text>
      <Text variant="bodySmall">
        Ảnh chỉ để hiển thị trong ô ký; giá trị pháp lý nằm ở chữ ký số MySign.
      </Text>
      {view.loading && <Text>Đang tải ảnh chữ ký…</Text>}
      {!!view.error && <Text style={ui.red}>{view.error}</Text>}
      {view.value && !view.value.present && <Text>Bạn chưa có ảnh chữ ký.</Text>}
      {view.value?.present && !!uri.value && (
        <Image
          accessibilityLabel="Ảnh chữ ký hiện tại"
          source={{ uri: uri.value }}
          style={{
            width: '100%',
            aspectRatio: view.value.width / view.value.height,
            maxHeight: 110,
          }}
          resizeMode="contain"
        />
      )}
      <Input label="Họ tên để tạo ảnh chữ ký" value={name} onChange={setName} disabled={busy} />
      <Action
        disabled={busy || name.trim().length < 2 || name.trim().length > 60}
        onPress={() => void run(() => signing.generateImage(name), 'Đã tạo ảnh chữ ký từ họ tên.')}
      >
        Tạo ảnh từ họ tên
      </Action>
      {view.value?.present && (
        <Button
          disabled={busy}
          onPress={() => void run(() => signing.removeImage(), 'Đã xóa ảnh chữ ký.')}
        >
          Xóa ảnh chữ ký
        </Button>
      )}
      {!!error && <Text style={ui.red}>{error}</Text>}
      {!!notice && <Text>{notice}</Text>}
    </Box>
  );
}
