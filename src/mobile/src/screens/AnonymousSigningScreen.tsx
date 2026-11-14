import React, { useMemo, useRef, useState } from 'react';
import { Image, ScrollView, StyleSheet, View, type GestureResponderEvent } from 'react-native';
import { Button, Checkbox, HelperText, Text, TextInput } from 'react-native-paper';
import { createApiClient } from '../../../../packages/client-core/src/api';
import {
  internalSigningClient,
  signingMessage,
  type DrawnPoint,
  type SigningAccess,
} from '../../../../packages/client-core/src/internalSigning';
import { useSession } from '../lib/SessionProvider';
import { previewPngUri } from '../features/contracts/pdfPreview';

export default function AnonymousSigningScreen() {
  const { baseUrl } = useSession();
  const api = useMemo(() => internalSigningClient(createApiClient(baseUrl)), [baseUrl]);
  const [input, setInput] = useState(''),
    [token, setToken] = useState(''),
    [info, setInfo] = useState(''),
    [otp, setOtp] = useState('');
  const [access, setAccess] = useState<SigningAccess | null>(null),
    [page, setPage] = useState(1),
    [count, setCount] = useState(0),
    [uri, setUri] = useState('');
  const [consent, setConsent] = useState(false),
    [done, setDone] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [strokes, setStrokes] = useState<DrawnPoint[][]>([]);
  const path = useRef<DrawnPoint[][]>([]),
    lock = useRef(false);
  const [width, setWidth] = useState(1);
  function touch(e: GestureResponderEvent) {
    return {
      x: Math.max(0, Math.min(1, e.nativeEvent.locationX / width)),
      y: Math.max(0, Math.min(1, e.nativeEvent.locationY / 180)),
    };
  }
  async function run(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      setError(signingMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function loadPage(secret: string, next: SigningAccess, number: number) {
    const bytes = await api.page(secret, next.session, number);
    try {
      setUri(previewPngUri(bytes));
      setPage(number);
    } finally {
      bytes.fill(0);
    }
  }
  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <Text variant="headlineSmall">Chấp thuận hợp đồng BHOME</Text>
      <Text>
        Chấp thuận nội bộ bằng OTP và nét vẽ, không phải chữ ký số CA. Không cần tài khoản trước khi
        ký.
      </Text>
      {!!error && <HelperText type="error">{error}</HelperText>}
      {done ? (
        <Text>
          Đã ghi nhận chấp thuận. Owner tiếp tục xác nhận, kiểm tra cọc và kích hoạt; lời mời tài
          khoản được gửi sau khi Main Active.
        </Text>
      ) : !access ? (
        <>
          {!token ? (
            <>
              <TextInput
                label="Liên kết lời mời ký"
                value={input}
                onChangeText={setInput}
                autoCapitalize="none"
                secureTextEntry
                disabled={busy}
              />
              <Button
                disabled={busy || !input}
                onPress={() =>
                  void run(async () => {
                    const secret = input.includes('#')
                      ? (new URLSearchParams(input.split('#')[1]).get('token') ?? '')
                      : input.trim();
                    const value = await api.info(secret);
                    setToken(secret);
                    setInput('');
                    setInfo(value.maskedEmail);
                    setDone(value.accepted);
                  })
                }
              >
                Mở lời mời
              </Button>
            </>
          ) : (
            <>
              <Text>Email xác nhận: {info}</Text>
              <Button disabled={busy} onPress={() => void run(() => api.otp(token))}>
                Gửi mã OTP
              </Button>
              <TextInput
                label="Mã OTP 6 chữ số"
                keyboardType="number-pad"
                maxLength={6}
                value={otp}
                onChangeText={setOtp}
                disabled={busy}
              />
              <Button
                disabled={busy || otp.length !== 6}
                onPress={() =>
                  void run(async () => {
                    const next = await api.verify(token, otp),
                      layout = await api.layout(token, next.session);
                    await loadPage(token, next, 1);
                    setCount(layout.pages.length);
                    setAccess(next);
                    setOtp('');
                  })
                }
              >
                Xác minh và xem hợp đồng
              </Button>
            </>
          )}
        </>
      ) : (
        <>
          {!!uri && (
            <Image
              source={{ uri }}
              style={styles.page}
              resizeMode="contain"
              accessibilityLabel={'Trang hợp đồng ' + page}
            />
          )}
          <Text>
            Trang {page}/{count}
          </Text>
          <Button
            disabled={busy || page <= 1}
            onPress={() => void run(() => loadPage(token, access, page - 1))}
          >
            Trang trước
          </Button>
          <Button
            disabled={busy || page >= count}
            onPress={() => void run(() => loadPage(token, access, page + 1))}
          >
            Trang tiếp
          </Button>
          <Text>Vẽ chữ ký trong khung</Text>
          <View
            style={styles.signature}
            accessibilityLabel="Khung vẽ chữ ký"
            onLayout={(e) => {
              setWidth(e.nativeEvent.layout.width);
            }}
            onStartShouldSetResponder={() => !busy}
            onMoveShouldSetResponder={() => !busy}
            onResponderGrant={(e) => {
              if (path.current.length < 20) {
                path.current.push([touch(e)]);
                setStrokes(path.current.map((s) => [...s]));
              }
            }}
            onResponderMove={(e) => {
              const stroke = path.current.at(-1);
              if (stroke && stroke.length < 1000 && path.current.flat().length < 4000) {
                stroke.push(touch(e));
                setStrokes(path.current.map((s) => [...s]));
              }
            }}
          >
            {strokes.flatMap((s, si) =>
              s.slice(1).map((p, pi) => {
                const prev = s[pi]!,
                  dx = (p.x - prev.x) * width,
                  dy = (p.y - prev.y) * 180,
                  length = Math.hypot(dx, dy);
                return (
                  <View
                    key={si + ':' + pi}
                    pointerEvents="none"
                    style={[
                      styles.ink,
                      {
                        left: ((p.x + prev.x) * width) / 2 - length / 2,
                        top: (p.y + prev.y) * 90,
                        width: length,
                        transform: [{ rotate: Math.atan2(dy, dx) + 'rad' }],
                      },
                    ]}
                  />
                );
              }),
            )}
          </View>
          <Button
            disabled={busy}
            onPress={() => {
              path.current = [];
              setStrokes([]);
            }}
          >
            Vẽ lại
          </Button>
          <Checkbox.Item
            label="Tôi đã đọc đúng PDF, đồng ý nội dung và dùng nét ký trên để chấp thuận"
            status={consent ? 'checked' : 'unchecked'}
            onPress={() => setConsent((v) => !v)}
            disabled={busy}
          />
          <Button
            mode="contained"
            disabled={busy || !consent || !strokes.some((s) => s.length >= 2)}
            onPress={() =>
              void run(async () => {
                await api.accept(
                  token,
                  access,
                  consent,
                  path.current.filter((s) => s.length >= 2),
                );
                const latest = await api.info(token);
                if (!latest.accepted)
                  throw new Error('Chưa xác nhận kết quả ký. Vui lòng tải lại trạng thái.');
                setDone(latest.accepted);
                setUri('');
                path.current = [];
                setStrokes([]);
              })
            }
          >
            Chấp thuận hợp đồng
          </Button>
        </>
      )}
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  content: { padding: 20, gap: 14 },
  page: { width: '100%', height: 520, backgroundColor: 'white' },
  signature: {
    height: 180,
    backgroundColor: 'white',
    borderColor: '#667085',
    borderWidth: 1,
    overflow: 'hidden',
  },
  ink: { position: 'absolute', height: 3, backgroundColor: '#111827' },
});
