import { ContractPdfPreview } from './ContractPdfPreview';
import { ContractPreviewSummary } from './ContractPreviewSummary';
import { KeyboardFormScrollView } from '../../components/KeyboardFormScrollView';
import { useFeedbackState } from '../../lib/useFeedbackState';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, StyleSheet, View } from 'react-native';
import { ActivityIndicator, Button, IconButton, Portal, Text, TextInput } from 'react-native-paper';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import {
  mainDraftClient,
  formatDraftMoney,
  mainDraftMessages,
  type MainDraftFiles,
  type MainDraftInput,
  type MainDraftPreparation,
  type MainDraftView,
} from '../../../../../packages/client-core/src/mainDrafts';
import {
  contractError,
  displayContractDate,
  mutationKeys,
  labels,
} from '../../../../../packages/client-core/src/contracts';
import { useSession } from '../../lib/SessionProvider';
import { randomUUID } from '../../lib/randomUUID';
import { inputDate } from '../../lib/identity';
import { Box, Heading, Pill } from '../../components/WorkspaceKit';
import { staffColors as s } from '../../theme/theme';
import { ContractDateField } from '../../components/ContractDateField';
import { ToastHost } from '../../components/ToastHost';
import { showSuccess, showWarning } from '../../lib/toast';

const iso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
function message(error: unknown) {
  const code = (error as { code?: string }).code;
  if ((error as { status?: number })?.status === 503 && !mainDraftMessages[code ?? ''])
    return 'Máy chủ chưa xử lý được hợp đồng. Hãy thử lại sau.';
  if (error instanceof Error && error.message === 'Thiết bị chưa có trình mở tài liệu.')
    return 'Thiết bị chưa hỗ trợ mở tài liệu bên ngoài. Bạn vẫn có thể đọc PDF trong ứng dụng.';
  return code && mainDraftMessages[code] ? mainDraftMessages[code] : contractError(error);
}
export function MainDraftScreen({
  initialId,
  roomId,
  representativeResidentId,
  residentIds,
  onCancel,
  onList,
  onSaved,
  persistRoute = true,
}: {
  initialId?: string;
  roomId: string;
  representativeResidentId: string;
  residentIds: string[];
  onCancel: () => void;
  onList: () => void;
  onSaved?: (id: string) => void;
  persistRoute?: boolean;
}) {
  const { api } = useSession();
  const client = useMemo(
    () => (api ? mainDraftClient((path, init, type) => api.request(path, init, type)) : null),
    [api],
  );
  const [id, setId] = useState(initialId ?? '');
  const [saved, setSaved] = useState<MainDraftView | null>(null);
  const readOnly = !!saved && saved.status !== 'Draft';
  const [preparation, setPreparation] = useState<MainDraftPreparation | null>(null);
  const [start, setStart] = useState(displayContractDate(iso(new Date())));
  const [end, setEnd] = useState('');
  const [phone, setPhone] = useState(''),
    [place, setPlace] = useState(''),
    [notes, setNotes] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview' | 'success'>('edit');
  const [documents, setDocuments] = useState<MainDraftFiles | null>(null);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useFeedbackState();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [revision, setRevision] = useState(0);
  const [keys] = useState(() => mutationKeys(randomUUID));
  const lock = useRef(false),
    alive = useRef(true),
    dirty = useRef(false);
  const operation = useRef<AbortController | null>(null);
  const calendarClose = useRef<(() => void) | null>(null);
  const routePromotion = useRef<{ id: string; client: typeof client } | null>(null);
  const refs = useRef({ roomId, representativeResidentId, residentIds });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      operation.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (!client) return;
    const controller = new AbortController();
    async function load() {
      if (
        initialId &&
        routePromotion.current?.id === initialId &&
        routePromotion.current.client === client
      ) {
        routePromotion.current = null;
        setLoading(false);
        return;
      }
      setLoading(true);
      setError('');
      try {
        if (initialId) {
          const draft = await client!.get(initialId, controller.signal);
          if (controller.signal.aborted) return;
          setId(draft.id);
          setSaved(draft);
          setPreparation(draft.preparation);
          refs.current = draft.input;
          setStart(displayContractDate(draft.input.startDate));
          setEnd(displayContractDate(draft.input.endDate));
          setPhone(draft.input.tenantPhone);
          setPlace(draft.input.tenantPlaceOfIssue);
          setNotes(draft.input.notes);
          dirty.current = false;
        } else {
          const result = await client!.prepare(
            { ...refs.current, startDate: iso(new Date()) },
            controller.signal,
          );
          if (!controller.signal.aborted) {
            setPreparation(result);
            setPhone(result.residents.find((r) => r.representative)?.phone ?? '');
          }
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(message(e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [client, initialId, revision, setError]);
  function input(): MainDraftInput | null {
    const errors: Record<string, string> = {};
    let from = '',
      to = '';
    try {
      from = inputDate(start)!;
    } catch {
      errors.start = 'Nhập ngày bắt đầu hợp lệ theo dd/MM/yyyy.';
    }
    try {
      to = inputDate(end)!;
    } catch {
      errors.end = 'Nhập ngày kết thúc hợp lệ theo dd/MM/yyyy.';
    }
    if (from && to && to <= from) errors.end = 'Ngày kết thúc phải sau ngày bắt đầu.';
    if (!phone.trim()) errors.phone = 'Bổ sung số điện thoại người thuê.';
    if (!place.trim()) errors.place = 'Bổ sung nơi cấp theo giấy tờ.';
    setFieldErrors(errors);
    return Object.keys(errors).length
      ? null
      : {
          ...refs.current,
          startDate: from,
          endDate: to,
          notes,
          tenantPhone: phone.trim(),
          tenantPlaceOfIssue: place.trim(),
          expectedVersion: saved?.version ?? 0,
        };
  }
  async function save(preview: boolean) {
    if (!client || lock.current || readOnly) return;
    const body = input();
    if (!body) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    operation.current = controller;
    try {
      const prep = await client.prepare(body, controller.signal);
      if (!alive.current) return;
      setPreparation(prep);
      if (prep.blockers.length) {
        setError(prep.blockers.map((code) => mainDraftMessages[code] ?? code).join('\n'));
        return;
      }
      const result = await client.save(
        id || null,
        body,
        keys.get('main-draft', body),
        controller.signal,
      );
      keys.confirmed('main-draft', body);
      if (!alive.current) return;
      setId(result.id);
      setSaved(result);
      setPhone(result.input.tenantPhone);
      setPreparation(result.preparation);
      dirty.current = false;
      if (initialId !== result.id) routePromotion.current = { id: result.id, client };
      onSaved?.(result.id);
      // Only reference IDs enter navigation state; never identity fields or document URLs.
      if (persistRoute) router.setParams({ mainDraftId: result.id });
      if (result.status !== 'Draft') throw { code: 'draft_version_or_status_changed' };
      showSuccess('Đã lưu hợp đồng nháp.');
      if (preview) {
        setDocuments(null);
        setMode('preview');
        const resultFiles = await client.generate(result.id, controller.signal);
        if (alive.current) {
          setDocuments(resultFiles);
          if (resultFiles.previewError)
            showWarning(
              mainDraftMessages[resultFiles.previewError] ?? 'Bản nháp đã lưu; chưa tạo được PDF.',
            );
        }
      } else setMode('success');
    } catch (e) {
      if (alive.current && !controller.signal.aborted) setError(message(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function openFile(pdf: boolean) {
    const document = pdf ? documents?.pdf : documents?.docx;
    if (!client || !document || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    let file: File | null = null;
    const controller = new AbortController();
    operation.current = controller;
    try {
      const bytes = await client.file(id, document.id, controller.signal);
      try {
        const signature = pdf ? [37, 80, 68, 70, 45] : [80, 75, 3, 4];
        if (
          bytes.length < signature.length ||
          signature.some((value, index) => bytes[index] !== value)
        )
          throw { code: 'draft_download_invalid' };
        const mime = pdf
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        if (Platform.OS === 'web') {
          const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
          const a = window.document.createElement('a');
          a.href = url;
          a.download = `hop-dong-nhap.${pdf ? 'pdf' : 'docx'}`;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } else {
          if (!(await Sharing.isAvailableAsync()))
            throw new Error('Thiết bị chưa có trình mở tài liệu.');
          const dir = new Directory(Paths.cache, 'bhome-contract-downloads');
          dir.create({ idempotent: true, intermediates: true });
          file = new File(dir, `${randomUUID()}.${pdf ? 'pdf' : 'docx'}`);
          file.create();
          file.write(bytes);
          await Sharing.shareAsync(file.uri, {
            mimeType: mime,
            dialogTitle: pdf ? 'Xem hợp đồng PDF' : 'Mở hợp đồng DOCX',
          });
        }
      } finally {
        bytes.fill(0);
      }
    } catch (e) {
      if (alive.current) setError(message(e));
    } finally {
      if (file?.exists) file.delete();
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function back() {
    if (calendarClose.current) {
      calendarClose.current();
      calendarClose.current = null;
      return;
    }
    if (busy) return;
    if (mode !== 'edit') {
      setMode('edit');
      return;
    }
    if (dirty.current)
      Alert.alert('Rời tạo hợp đồng?', 'Các thay đổi chưa lưu sẽ mất.', [
        { text: 'Tiếp tục nhập', style: 'cancel' },
        { text: 'Rời màn hình', onPress: onCancel },
      ]);
    else onCancel();
  }
  async function reviewSaved(confirm: boolean) {
    if (!client || !saved || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    operation.current = controller;
    try {
      const current = await client.get(id, controller.signal);
      if (current.version !== saved.version || current.status !== 'Draft')
        throw { code: 'draft_version_or_status_changed' };
      if (confirm) {
        if (alive.current) {
          setMode('success');
          showSuccess('Đã lưu hợp đồng nháp.');
        }
      } else {
        const result = await client.generate(id, controller.signal);
        if (alive.current) {
          setDocuments(result);
          setMode('preview');
        }
      }
    } catch (e) {
      if (alive.current && !controller.signal.aborted) setError(message(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function refreshPrices() {
    if (!client || lock.current || readOnly) return;
    let date: string;
    try {
      date = inputDate(start)!;
    } catch {
      setFieldErrors((before) => ({
        ...before,
        start: 'Nhập ngày bắt đầu hợp lệ theo dd/MM/yyyy.',
      }));
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    operation.current = controller;
    try {
      const result = await client.prepare({ ...refs.current, startDate: date }, controller.signal);
      if (alive.current) setPreparation(result);
    } catch (e) {
      if (alive.current && !controller.signal.aborted) setError(message(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const edit = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    dirty.current = true;
    setDocuments(null);
  };
  const representative = preparation?.residents.find((r) => r.representative);
  return (
    <Modal visible presentationStyle="fullScreen" onRequestClose={back} animationType="slide">
      <SafeAreaProvider>
        <Portal.Host>
          <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.root}>
            <View style={styles.header}>
              <IconButton
                icon="arrow-left"
                iconColor="#FFFFFF"
                accessibilityLabel="Quay lại tạo hợp đồng"
                onPress={back}
              />
              <Text style={styles.title}>
                {mode === 'preview'
                  ? 'Xem trước hợp đồng'
                  : mode === 'success'
                    ? 'Đã tạo hợp đồng nháp'
                    : 'Tạo hợp đồng thuê'}
              </Text>
            </View>
            <KeyboardAvoidingView
              style={styles.grow}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
              <KeyboardFormScrollView
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
              >
                {loading && <ActivityIndicator accessibilityLabel="Đang tải dữ liệu hợp đồng" />}
                {!!error && (
                  <Text accessibilityRole="alert" style={styles.error}>
                    {error}
                  </Text>
                )}
                {!loading && !preparation && (
                  <Button
                    contentStyle={{ minHeight: 48 }}
                    onPress={() => setRevision((v) => v + 1)}
                  >
                    Tải lại dữ liệu
                  </Button>
                )}
                {preparation && (
                  <>
                    {mode === 'edit' ? (
                      <>
                        {id && (
                          <Box>
                            <Pill>{labels[saved?.status ?? 'Draft'] ?? saved?.status}</Pill>
                            <Text selectable>Mã hợp đồng: {id}</Text>
                          </Box>
                        )}
                        <Box>
                          <Heading title="Thông tin phòng" detail="Dữ liệu do máy chủ cung cấp" />
                          <Text>
                            {preparation.locationName} · Phòng {preparation.roomNumber}
                          </Text>
                          <Text>{preparation.address}</Text>
                          <Text>
                            Giá thuê:{' '}
                            {preparation.charges.some((p) => p.chargeCode === 'RENT')
                              ? formatDraftMoney(
                                  preparation.charges.find((p) => p.chargeCode === 'RENT')!.rate,
                                )
                              : 'Chưa cấu hình'}{' '}
                            / tháng
                          </Text>
                        </Box>
                        <Box>
                          <Heading title="Người thuê đã xác minh" />
                          <Text>{representative?.fullName} · Đại diện</Text>
                          <Text>CCCD: {representative?.maskedCitizenNumber}</Text>
                          <Text>
                            Ngày cấp:{' '}
                            {representative?.dateOfIssue
                              ? displayContractDate(representative.dateOfIssue)
                              : 'Chưa có dữ liệu'}
                          </Text>
                          <Text>
                            {preparation.residents.length} người ở · Bên cho thuê:{' '}
                            {preparation.ownerName ?? 'Chưa cấu hình'}
                          </Text>
                          <Text>
                            Thông tin định danh chỉ đọc. Nếu sai, cần xử lý qua quy trình hồ sơ được
                            phép.
                          </Text>
                        </Box>
                      </>
                    ) : (
                      <ContractPreviewSummary
                        preparation={preparation}
                        status={saved?.status ?? 'Draft'}
                        start={start}
                        end={end}
                      />
                    )}
                    {preparation.blockers.map((code) => (
                      <Text key={code} style={styles.error}>
                        {mainDraftMessages[code] ?? code}
                      </Text>
                    ))}
                    {mode === 'success' && (
                      <Text selectable style={{ color: '#475569', fontSize: 12 }}>
                        Mã hợp đồng: {id}
                      </Text>
                    )}
                    {mode === 'edit' ? (
                      <Box>
                        <Heading
                          title="Điều khoản thuê"
                          detail="Giá và tiền cọc lấy từ cấu hình Owner theo ngày bắt đầu."
                        />
                        <ContractDateField
                          onCalendarChange={(close) => {
                            calendarClose.current = close;
                          }}
                          label="Ngày bắt đầu (dd/MM/yyyy)"
                          value={start}
                          onChange={edit(setStart)}
                          disabled={busy || readOnly}
                          error={fieldErrors.start}
                        />
                        <ContractDateField
                          onCalendarChange={(close) => {
                            calendarClose.current = close;
                          }}
                          label="Ngày kết thúc (dd/MM/yyyy)"
                          value={end}
                          onChange={edit(setEnd)}
                          disabled={busy || readOnly}
                          error={fieldErrors.end}
                        />
                        {(
                          [
                            ['phone', 'Số điện thoại người thuê', phone, setPhone],
                            ['place', 'Nơi cấp CCCD (chưa có trong hồ sơ)', place, setPlace],
                          ] as const
                        ).map(([name, label, value, setter]) => (
                          <View key={name} style={{ gap: 4 }}>
                            <TextInput
                              label={name === 'place' ? 'Nơi cấp CCCD' : label}
                              value={value}
                              mode="outlined"
                              error={!!fieldErrors[name]}
                              disabled={
                                busy || readOnly || (name === 'phone' && !!representative?.phone)
                              }
                              onChangeText={edit(setter)}
                              accessibilityLabel={label}
                            />
                            {!!fieldErrors[name] && (
                              <Text style={styles.error}>{fieldErrors[name]}</Text>
                            )}
                          </View>
                        ))}
                        <Button
                          contentStyle={{ minHeight: 48 }}
                          disabled={busy || readOnly}
                          onPress={() => void refreshPrices()}
                        >
                          Cập nhật giá theo ngày bắt đầu
                        </Button>
                        {preparation.charges.map((p) => (
                          <Text key={p.id}>
                            {p.name}: {formatDraftMoney(p.rate)}
                            {p.chargeCode === 'ELECTRICITY'
                              ? '/kWh'
                              : p.chargeCode === 'WATER'
                                ? '/m³'
                                : '/tháng'}
                          </Text>
                        ))}
                        <Text>
                          Tiền cọc dự kiến:{' '}
                          {preparation.securityDeposit === null
                            ? 'Chưa cấu hình'
                            : formatDraftMoney(preparation.securityDeposit)}
                        </Text>
                        <Text>Thanh toán: {preparation.paymentTerms ?? 'Chưa cấu hình'}</Text>
                        <TextInput
                          label="Điều khoản bổ sung / ghi chú"
                          value={notes}
                          onChangeText={edit(setNotes)}
                          mode="outlined"
                          multiline
                          maxLength={4000}
                          disabled={busy || readOnly}
                        />
                      </Box>
                    ) : mode === 'preview' && client ? (
                      <ContractPdfPreview
                        client={client}
                        contractId={id}
                        document={documents?.pdf ?? null}
                        busy={busy}
                        previewErrorCode={documents?.previewError ?? null}
                        hasDocx={!!documents?.docx}
                        onRegenerate={() => void reviewSaved(false)}
                        onOpenPdf={() => void openFile(true)}
                        onOpenDocx={() => void openFile(false)}
                      />
                    ) : null}
                  </>
                )}
              </KeyboardFormScrollView>
              <View style={styles.footer}>
                {busy && <ActivityIndicator />}
                {mode === 'edit' ? (
                  <>
                    <Button
                      contentStyle={{ minHeight: 48 }}
                      mode="outlined"
                      disabled={busy || readOnly || loading || !preparation}
                      onPress={() => void save(false)}
                    >
                      Lưu nháp
                    </Button>
                    <Button
                      contentStyle={{ minHeight: 48 }}
                      mode="contained"
                      buttonColor={s.blue}
                      disabled={busy || readOnly || loading || !preparation}
                      onPress={() => void save(true)}
                    >
                      Xem trước hợp đồng
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      contentStyle={{ minHeight: 48 }}
                      disabled={busy || readOnly}
                      onPress={() =>
                        mode === 'preview' ? setMode('edit') : void reviewSaved(false)
                      }
                    >
                      {mode === 'preview' ? 'Chỉnh sửa thông tin' : 'Xem hợp đồng'}
                    </Button>
                    {mode === 'preview' ? (
                      <Button
                        contentStyle={{ minHeight: 48 }}
                        mode="contained"
                        disabled={busy || readOnly}
                        onPress={() => void reviewSaved(true)}
                      >
                        Lưu hợp đồng nháp
                      </Button>
                    ) : (
                      <Button
                        contentStyle={{ minHeight: 48 }}
                        mode="contained"
                        disabled={busy || readOnly}
                        onPress={onList}
                      >
                        Về danh sách hợp đồng
                      </Button>
                    )}
                  </>
                )}
              </View>
            </KeyboardAvoidingView>
          </SafeAreaView>
          <ToastHost modal />
        </Portal.Host>
      </SafeAreaProvider>
    </Modal>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: s.background },
  grow: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: s.navy, paddingRight: 16 },
  title: { flex: 1, color: '#FFFFFF', fontSize: 18, lineHeight: 24, fontWeight: '700' },
  content: { padding: 16, gap: 16, maxWidth: 720, width: '100%', alignSelf: 'center' },
  footer: {
    padding: 16,
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  error: { color: '#B91C1C', fontSize: 14, lineHeight: 20 },
});
