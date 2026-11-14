import { RentalContractStepper } from './RentalContractStepper';
import { MainDraftSigningReview } from './MainDraftSigningReview';
import { workflowFailure } from '../../lib/workflowFailure';
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
  type PreviewDocument,
} from '../../../../../packages/client-core/src/contracts';
import { useSession } from '../../lib/SessionProvider';
import { randomUUID } from '../../lib/randomUUID';
import { inputDate } from '../../lib/identity';
import { Box, Heading, Pill, Row } from '../../components/WorkspaceKit';
import { staffColors as s, colors as c } from '../../theme/theme';
import { ContractDateField } from '../../components/ContractDateField';
import { ToastHost } from '../../components/ToastHost';
import { showSuccess } from '../../lib/toast';

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
  onReleased,
}: {
  initialId?: string;
  roomId: string;
  representativeResidentId: string;
  residentIds: string[];
  onCancel: () => void;
  onList: () => void;
  onSaved?: (id: string) => void;
  persistRoute?: boolean;
  onReleased?: (id: string) => void;
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
    [email, setEmail] = useState(''),
    [notes, setNotes] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview' | 'signing'>('edit');
  const [signingVisited, setSigningVisited] = useState(false);
  const [documents, setDocuments] = useState<MainDraftFiles | null>(null);
  const [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useFeedbackState('error', false);
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
          setEmail(
            draft.input.tenantEmail ??
              draft.preparation.residents.find((r) => r.representative)?.email ??
              '',
          );
          dirty.current = false;
        } else {
          const result = await client!.prepare(
            { ...refs.current, startDate: iso(new Date()) },
            controller.signal,
          );
          if (!controller.signal.aborted) {
            setPreparation(result);
            setPhone(result.residents.find((r) => r.representative)?.phone ?? '');
            setEmail(result.residents.find((r) => r.representative)?.email ?? '');
          }
        }
      } catch (e) {
        workflowFailure('main-draft', e);
        if (!controller.signal.aborted) setError(message(e));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [client, initialId, revision, setError]);
  useEffect(() => {
    if (!client || !id || mode !== 'signing' || saved?.status !== 'Draft') return;
    const controller = new AbortController();
    let running = false;
    let finished = false;
    const timer = setInterval(() => {
      if (running || finished || lock.current) return;
      running = true;
      void client
        .get(id, controller.signal)
        .then((latest) => {
          if (controller.signal.aborted || latest.status === 'Draft') return;
          finished = true;
          if (onReleased) onReleased(latest.id);
          else onList();
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(message(e));
        })
        .finally(() => {
          running = false;
        });
    }, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [client, id, mode, saved?.status, onReleased, onList, setError]);
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
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || email.trim().length > 256)
      errors.email = 'Nhập email người thuê hợp lệ.';
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
          tenantEmail: email.trim(),
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
      setEmail(result.input.tenantEmail ?? email.trim());
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
        }
      } else setMode('edit');
    } catch (e) {
      workflowFailure('main-draft', e);
      if (alive.current && !controller.signal.aborted) setError(message(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  async function openFile(pdf: boolean, override?: PreviewDocument) {
    const document = override ?? (pdf ? documents?.pdf : documents?.docx);
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
      workflowFailure('main-draft', e);
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
      setMode(mode === 'signing' ? 'preview' : 'edit');
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
          setSigningVisited(true);
          setMode('signing');
        }
      } else {
        const result = await client.generate(id, controller.signal);
        if (alive.current) {
          setDocuments(result);
          setMode('preview');
        }
      }
    } catch (e) {
      workflowFailure('main-draft', e);
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
      workflowFailure('main-draft', e);
      if (alive.current && !controller.signal.aborted) setError(message(e));
    } finally {
      lock.current = false;
      if (alive.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (!client || loading || readOnly || !preparation) return;
    let date: string;
    try {
      date = inputDate(start)!;
    } catch {
      return;
    }
    if (date === preparation.effectiveOn) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void client
        .prepare({ ...refs.current, startDate: date }, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setPreparation(result);
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(message(e));
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [client, loading, readOnly, start, preparation, setError]);
  const edit = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    dirty.current = true;
    setDocuments(null);
  };
  const representative = preparation?.residents.find((r) => r.representative);
  // The web modal inherits the app's safe-area context. A nested provider can measure
  // the opening animation as a full-height bottom inset and collapse the scroll area.
  const ModalSafeArea = Platform.OS === 'web' ? React.Fragment : SafeAreaProvider;
  return (
    <Modal visible presentationStyle="fullScreen" onRequestClose={back} animationType="slide">
      <ModalSafeArea>
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
                  : mode === 'signing'
                    ? 'Ký hợp đồng'
                    : 'Tạo hợp đồng thuê'}
              </Text>
            </View>
            <KeyboardAvoidingView
              style={styles.grow}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
              <KeyboardFormScrollView
                style={styles.grow}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
              >
                <RentalContractStepper current={mode === 'signing' ? 1 : 0} />
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
                          <Heading title="Thông tin phòng" />
                          <Text style={styles.roomName}>
                            {preparation.locationName} · Phòng {preparation.roomNumber}
                          </Text>
                          <Text style={styles.support}>{preparation.address}</Text>
                          {preparation.charges.some((p) => p.chargeCode === 'RENT') && (
                            <Text>
                              Giá thuê:{' '}
                              {formatDraftMoney(
                                preparation.charges.find((p) => p.chargeCode === 'RENT')!.rate,
                              )}
                              /tháng
                            </Text>
                          )}
                        </Box>
                        <Box>
                          <Heading title="Người thuê" />
                          <Row spread>
                            <Text style={styles.personName}>{representative?.fullName}</Text>
                            <Pill tone="green">Đã xác minh</Pill>
                          </Row>
                          <Text style={styles.support}>
                            Đại diện · {preparation.residents.length} người ở
                          </Text>
                          {!!representative?.maskedCitizenNumber && (
                            <Text>CCCD: {representative.maskedCitizenNumber}</Text>
                          )}
                          <TextInput
                            label="Email người thuê *"
                            accessibilityLabel="Email người thuê *"
                            placeholder="Nhập email người thuê"
                            value={email}
                            onChangeText={edit(setEmail)}
                            onBlur={() => setEmail((v) => v.trim())}
                            keyboardType="email-address"
                            autoCapitalize="none"
                            autoCorrect={false}
                            maxLength={256}
                            mode="outlined"
                            disabled={busy || readOnly}
                            error={!!fieldErrors.email}
                          />
                          {!!fieldErrors.email && (
                            <Text style={styles.error}>{fieldErrors.email}</Text>
                          )}
                          <Text style={styles.support}>
                            Email liên hệ, chưa tạo tài khoản Tenant.
                          </Text>
                          <TextInput
                            label="Số điện thoại người thuê"
                            accessibilityLabel="Số điện thoại người thuê"
                            value={phone}
                            keyboardType="phone-pad"
                            maxLength={30}
                            mode="outlined"
                            disabled={busy || readOnly || !!representative?.phone}
                            error={!!fieldErrors.phone}
                            onChangeText={edit(setPhone)}
                          />
                          {!!fieldErrors.phone && (
                            <Text style={styles.error}>{fieldErrors.phone}</Text>
                          )}
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
                    {!!preparation.blockers.length && (
                      <View style={styles.notice} accessibilityRole="alert">
                        <Text style={styles.noticeTitle}>Thiếu cấu hình hợp đồng</Text>
                        {preparation.blockers.map((code) => (
                          <Text key={code} style={styles.support}>
                            {mainDraftMessages[code] ??
                              'Cần Owner kiểm tra điều kiện hợp đồng trên hệ thống.'}
                          </Text>
                        ))}
                      </View>
                    )}
                    {signingVisited && client && saved && (
                      <View style={mode === 'signing' ? undefined : { display: 'none' }}>
                        <MainDraftSigningReview
                          key={`${id}:${saved.version}`}
                          client={client}
                          draft={saved}
                          onBusyChange={setBusy}
                          onReleased={(next) => (onReleased ? onReleased(next) : onList())}
                          onOpenPdf={(file) => void openFile(true, file)}
                        />
                      </View>
                    )}
                    {mode === 'edit' ? (
                      <Box>
                        <Heading title="Điều khoản thuê" detail="Áp dụng theo ngày bắt đầu thuê." />
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
                        <Button
                          contentStyle={{ minHeight: 48 }}
                          disabled={busy || readOnly}
                          onPress={() => void refreshPrices()}
                        >
                          Cập nhật giá theo ngày bắt đầu
                        </Button>
                        {preparation.charges.map((p) => (
                          <Row key={p.id} spread>
                            <Text style={styles.chargeName}>
                              {{
                                RENT: 'Giá thuê',
                                ELECTRICITY: 'Điện',
                                WATER: 'Nước',
                                WIFI: 'Wi-Fi',
                              }[p.chargeCode] ?? p.name}
                            </Text>
                            <Text style={styles.chargeValue}>
                              {formatDraftMoney(p.rate)}
                              {p.chargeCode === 'ELECTRICITY'
                                ? '/kWh'
                                : p.chargeCode === 'WATER'
                                  ? '/m³'
                                  : '/tháng'}
                            </Text>
                          </Row>
                        ))}
                        {preparation.securityDeposit !== null && (
                          <Row spread>
                            <Text>Tiền cọc</Text>
                            <Text>{formatDraftMoney(preparation.securityDeposit)}</Text>
                          </Row>
                        )}
                        {!!preparation.paymentTerms && (
                          <Text>Thanh toán: {preparation.paymentTerms}</Text>
                        )}
                        <Heading title="Ghi chú / điều khoản bổ sung" />
                        <TextInput
                          label="Điều khoản bổ sung / ghi chú"
                          accessibilityLabel="Điều khoản bổ sung / ghi chú"
                          placeholder="Nhập điều khoản bổ sung (nếu có)"
                          value={notes}
                          onChangeText={edit(setNotes)}
                          mode="outlined"
                          multiline
                          numberOfLines={3}
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
                      mode="text"
                      style={styles.secondaryAction}
                      disabled={
                        busy || readOnly || loading || !preparation || !!preparation.blockers.length
                      }
                      onPress={() => void save(false)}
                    >
                      Lưu nháp
                    </Button>
                    <Button
                      contentStyle={{ minHeight: 48 }}
                      mode="contained"
                      buttonColor={s.blue}
                      style={styles.primaryAction}
                      disabled={
                        busy || readOnly || loading || !preparation || !!preparation.blockers.length
                      }
                      onPress={() => void save(true)}
                    >
                      Xem trước hợp đồng
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      style={styles.primaryAction}
                      labelStyle={{ fontSize: 12 }}
                      contentStyle={{ minHeight: 48 }}
                      disabled={busy || readOnly}
                      onPress={() => (mode === 'preview' ? setMode('edit') : setMode('preview'))}
                    >
                      {mode === 'preview' ? 'Chỉnh sửa thông tin' : 'Xem hợp đồng'}
                    </Button>
                    {mode === 'preview' ? (
                      <Button
                        style={styles.primaryAction}
                        labelStyle={{ fontSize: 12 }}
                        contentStyle={{ minHeight: 48 }}
                        mode="contained"
                        disabled={busy || readOnly || !documents?.pdf}
                        onPress={() => void reviewSaved(true)}
                      >
                        Tiếp tục ký hợp đồng
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
      </ModalSafeArea>
    </Modal>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background },
  grow: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', backgroundColor: s.navy, paddingRight: 16 },
  title: { flex: 1, color: '#FFFFFF', fontSize: 18, lineHeight: 24, fontWeight: '700' },
  content: { padding: 16, gap: 16, maxWidth: 720, width: '100%', alignSelf: 'center' },
  footer: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  primaryAction: { flex: 1, minWidth: 0 },
  secondaryAction: { flexShrink: 0 },
  personName: { flex: 1, color: s.navy, fontWeight: '600', fontSize: 16 },
  roomName: { color: s.navy, fontWeight: '600', fontSize: 16 },
  support: { color: '#475569', fontSize: 13, lineHeight: 19 },
  chargeName: { flex: 1, minWidth: 0, color: c.muted, fontSize: 14 },
  chargeValue: { flexShrink: 1, textAlign: 'right', color: c.ink, fontSize: 14, fontWeight: '600' },
  notice: { backgroundColor: '#FFF8E6', padding: 14, gap: 6, borderRadius: 12 },
  noticeTitle: { color: s.navy, fontSize: 15, fontWeight: '600' },
  error: { color: '#B91C1C', fontSize: 14, lineHeight: 20 },
});
