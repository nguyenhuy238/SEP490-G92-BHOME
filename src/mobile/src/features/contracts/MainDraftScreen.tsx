import { ContractNotice } from './ContractNotice';
import { RentalContractStepper } from './RentalContractStepper';
import { MainContractProgress } from './MainContractProgress';
import { MainDraftSigningReview } from './MainDraftSigningReview';
import { workflowFailure } from '../../lib/workflowFailure';
import { ContractPdfPreview } from './ContractPdfPreview';
import { ContractPreviewSummary } from './ContractPreviewSummary';
import { KeyboardFormScrollView } from '../../components/KeyboardFormScrollView';
import { useFeedbackState } from '../../lib/useFeedbackState';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  businessToday,
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
import { previewErrorCode, requiresNewDocument } from './pdfPreview';
import { deliverWebDocument, openPdfWindow } from './webContractDocument';
import { ownerContractSteps } from '../owner/ownerContractSteps';

function endOfTerm(start: string, months: 6 | 12) {
  const [year, month, day] = start.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, month + months, 0)).getUTCDate();
  return new Date(Date.UTC(year, month + months - 1, Math.min(day, lastDay)))
    .toISOString()
    .slice(0, 10);
}
function message(error: unknown) {
  const code = previewErrorCode(error);
  if (code === 'pdf_popup_blocked')
    return 'Trình duyệt chặn cửa sổ PDF. Cho phép cửa sổ bật lên hoặc chọn Tải PDF.';
  if (code === 'pdf_window_closed') return 'Cửa sổ PDF đã đóng. Chọn Xem PDF để mở lại.';
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
  reviewOnly = false,
  visible = true,
  onPrevious,
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
  reviewOnly?: boolean;
  visible?: boolean;
  onPrevious?: () => void;
}) {
  const { api, session } = useSession();
  const owner = !!session?.roles.includes('Owner');
  const staff = !owner && !!session?.roles.includes('Staff');
  const client = useMemo(
    () => (api ? mainDraftClient((path, init, type) => api.request(path, init, type)) : null),
    [api],
  );
  const [id, setId] = useState(initialId ?? '');
  const [saved, setSaved] = useState<MainDraftView | null>(null);
  const readOnly = !!saved && saved.status !== 'Draft';
  const [preparation, setPreparation] = useState<MainDraftPreparation | null>(null);
  const [start, setStart] = useState(() => displayContractDate(businessToday()));
  const [end, setEnd] = useState(() =>
    staff ? displayContractDate(endOfTerm(businessToday(), 6)) : '',
  );
  const [termOpen, setTermOpen] = useState(false);
  const [phone, setPhone] = useState(''),
    [place, setPlace] = useState(''),
    [email, setEmail] = useState(''),
    [notes, setNotes] = useState('');
  const [mode, setMode] = useState<'edit' | 'preview' | 'signing'>('edit');
  const [signingVisited, setSigningVisited] = useState(false);
  const [documents, setDocuments] = useState<
    | (Omit<MainDraftFiles, 'docx'> & {
        docx: MainDraftFiles['docx'] | null;
      })
    | null
  >(null);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [readyFile, setReadyFile] = useState(''),
    [documentBlocker, setDocumentBlocker] = useState('');
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
  const formScroll = useRef<React.ComponentRef<typeof KeyboardFormScrollView>>(null);
  useEffect(() => {
    if (owner) formScroll.current?.scrollTo({ y: 0, animated: false });
  }, [mode, owner]);
  const currentOperation = (controller: AbortController) =>
    alive.current && operation.current === controller && !controller.signal.aborted;
  const calendarClose = useRef<(() => void) | null>(null);
  const routePromotion = useRef<{ id: string; client: typeof client } | null>(null);
  const refs = useRef({ roomId, representativeResidentId, residentIds });
  const releasedHandler = useRef(onReleased);
  const listHandler = useRef(onList);
  useEffect(() => {
    releasedHandler.current = onReleased;
    listHandler.current = onList;
  }, [onReleased, onList]);
  const invalidateDocument = useCallback(
    (error: unknown) => {
      setReadyFile('');
      if (!requiresNewDocument(error)) return;
      setDocuments(null);
      setReviewRevision((value) => value + 1);
      setReadyFile('');
      setDocumentBlocker(previewErrorCode(error));
      setError(message(error));
    },
    [setError],
  );
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
      // A route may reuse this component. Retire the previous resource and any generation
      // still in flight before adopting the new draft (including an explicit reload).
      operation.current?.abort();
      operation.current = null;
      lock.current = false;
      setBusy(false);
      setId(initialId ?? '');
      setSaved(null);
      setDocuments(null);
      setReadyFile('');
      setDocumentBlocker('');
      setReviewRevision((value) => value + 1);
      setSigningVisited(reviewOnly);
      setMode(reviewOnly ? 'signing' : 'edit');
      setLoading(true);
      setError('');
      try {
        if (initialId) {
          const draft = await client!.get(initialId, controller.signal);
          if (controller.signal.aborted) return;
          if (draft.status !== 'Draft') {
            if (releasedHandler.current) releasedHandler.current(draft.id);
            else listHandler.current();
            return;
          }
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
          const today = businessToday();
          const result = await client!.prepare(
            { ...refs.current, startDate: today },
            controller.signal,
          );
          if (!controller.signal.aborted) {
            setStart(displayContractDate(today));
            setEnd(staff ? displayContractDate(endOfTerm(today, 6)) : '');
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
  }, [client, initialId, revision, setError, owner, staff, reviewOnly]);
  useEffect(() => {
    if (!client || !id || mode !== 'signing' || saved?.status !== 'Draft') return;
    const controller = new AbortController();
    let running = false;
    let finished = false;
    const refresh = () => {
      if (running || finished || lock.current) return;
      running = true;
      void client
        .get(id, controller.signal)
        .then((latest) => {
          if (controller.signal.aborted || latest.status === 'Draft') return;
          finished = true;
          if (releasedHandler.current) releasedHandler.current(latest.id);
          else listHandler.current();
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(message(e));
        })
        .finally(() => {
          running = false;
        });
    };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [client, id, mode, saved?.status, setError]);
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
    if (!staff && !phone.trim()) errors.phone = 'Bổ sung số điện thoại người thuê.';
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
          tenantEmail: null,
          expectedVersion: saved?.version ?? 0,
        };
  }
  async function generatePreview(draftId: string, signal: AbortSignal) {
    if (staff) {
      const pdf = await client!.signingReview(draftId, signal);
      return { pdf, docx: null, previewError: null };
    }
    return client!.generate(draftId, signal);
  }
  async function save(preview: boolean) {
    if (!client || lock.current || readOnly) return;
    // Reading an unchanged Owner draft must not increment its version and retire the
    // PDF another viewer/reviewer is using. Generation already validates current state.
    if (preview && owner && saved && !dirty.current) {
      await reviewSaved(false);
      return;
    }
    const body = input();
    if (!body) return;
    setTermOpen(false);
    lock.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    operation.current = controller;
    try {
      const prep = await client.prepare(body, controller.signal);
      if (!currentOperation(controller)) return;
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
      if (!currentOperation(controller)) return;
      setId(result.id);
      setReadyFile('');
      setDocumentBlocker('');
      setDocuments(null);
      setReviewRevision((value) => value + 1);
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
      showSuccess(staff ? 'Đã lưu hợp đồng.' : 'Đã lưu hợp đồng nháp.');
      if (preview) {
        setDocuments(null);
        setMode('preview');
        const resultFiles = await generatePreview(result.id, controller.signal);
        if (currentOperation(controller)) {
          setDocumentBlocker('');
          setDocuments(resultFiles);
        }
      } else setMode('edit');
    } catch (e) {
      if (!currentOperation(controller)) return;
      invalidateDocument(e);
      workflowFailure('main-draft', e);
      if (alive.current && !controller.signal.aborted) setError(message(e));
    } finally {
      if (operation.current === controller) {
        lock.current = false;
        if (alive.current) setBusy(false);
      }
    }
  }
  async function openFile(pdf: boolean, override?: PreviewDocument, view = false) {
    const document = override ?? (pdf ? documents?.pdf : documents?.docx);
    if (!client || !document || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    let file: File | null = null;
    const controller = new AbortController();
    operation.current = controller;
    let tab: Window | null = null;
    try {
      if (pdf && view && Platform.OS === 'web') tab = openPdfWindow();
      const bytes = await client.file(id, document.id, controller.signal);
      try {
        if (!currentOperation(controller)) {
          tab?.close();
          return;
        }
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
          deliverWebDocument(
            bytes,
            pdf,
            `hop-dong-phong-${preparation?.roomNumber ?? 'thue'}-${document.id.slice(0, 8)}.${pdf ? 'pdf' : 'docx'}`,
            tab,
          );
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
        return true;
      } finally {
        bytes.fill(0);
      }
    } catch (e) {
      tab?.close();
      if (!currentOperation(controller)) return;
      invalidateDocument(e);
      workflowFailure('main-draft', e);
      if (alive.current) setError(message(e));
    } finally {
      if (file?.exists) file.delete();
      if (operation.current === controller) {
        lock.current = false;
        if (alive.current) setBusy(false);
      }
    }
  }
  function back() {
    if (calendarClose.current) {
      calendarClose.current();
      calendarClose.current = null;
      return;
    }
    if (busy) return;
    if (reviewOnly) return onCancel();
    if (mode !== 'edit') {
      setMode(mode === 'signing' ? 'preview' : 'edit');
      return;
    }
    if (onPrevious) {
      onPrevious();
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
    const reviewedPdf = documents?.pdf;
    if (confirm && (!reviewedPdf || (owner && readyFile !== reviewedPdf.id))) return;
    if (!confirm && documentBlocker.includes('save_again')) {
      setMode('edit');
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    const controller = new AbortController();
    operation.current = controller;
    try {
      const current = await client.get(id, controller.signal);
      if (!currentOperation(controller)) return;
      if (current.status !== 'Draft') {
        setDocuments(null);
        setReadyFile('');
        setSaved(current);
        setReviewRevision((value) => value + 1);
        if (owner || staff) {
          if (releasedHandler.current) releasedHandler.current(current.id);
          else onList();
          return;
        }
        throw { code: 'draft_version_or_status_changed' };
      }
      if (current.version !== saved.version) {
        setSaved(current);
        setDocuments(null);
        setReviewRevision((value) => value + 1);
        setPreparation(current.preparation);
        refs.current = current.input;
        setStart(displayContractDate(current.input.startDate));
        setEnd(displayContractDate(current.input.endDate));
        setPhone(current.input.tenantPhone);
        setPlace(current.input.tenantPlaceOfIssue);
        setEmail(current.input.tenantEmail ?? '');
        setNotes(current.input.notes);
        dirty.current = false;
        if (confirm) throw { code: 'draft_version_or_status_changed' };
      }
      if (confirm && reviewedPdf) {
        if (staff) {
          const input = {
            tenantUserId: null,
            expectedVersion: current.version,
            reviewedFileId: reviewedPdf.id,
            humanReviewed: true,
            emailSigning: true,
          };
          const key = keys.get('main-draft-release', input);
          const released = await client.release(id, input, key);
          keys.confirmed('main-draft-release', input);
          if (currentOperation(controller)) {
            if (releasedHandler.current) releasedHandler.current(released.id);
            else onList();
          }
        } else if (alive.current) {
          setSigningVisited(true);
          setMode('signing');
        }
      } else {
        setDocuments(null);
        setReviewRevision((value) => value + 1);
        const result = await generatePreview(id, controller.signal);
        if (currentOperation(controller)) {
          setDocumentBlocker('');
          setError('');
          setDocuments(result);
          setMode('preview');
        }
      }
    } catch (e) {
      if (!currentOperation(controller)) return;
      invalidateDocument(e);
      workflowFailure('main-draft', e);
      if (alive.current && !controller.signal.aborted) setError(message(e));
    } finally {
      if (operation.current === controller) {
        lock.current = false;
        if (alive.current) setBusy(false);
      }
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
      if (currentOperation(controller)) setPreparation(result);
    } catch (e) {
      workflowFailure('main-draft', e);
      if (alive.current && !controller.signal.aborted) setError(message(e));
    } finally {
      if (operation.current === controller) {
        lock.current = false;
        if (alive.current) setBusy(false);
      }
    }
  }
  useEffect(() => {
    if (!client || loading || readOnly || reviewOnly || !preparation) return;
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
  }, [client, loading, readOnly, reviewOnly, start, preparation, setError]);
  const edit = (setter: (v: string) => void) => (value: string) => {
    setter(value);
    dirty.current = true;
    setReadyFile('');
    setDocuments(null);
  };
  const representative = preparation?.residents.find((r) => r.representative);
  const rent = preparation?.charges.find((charge) => charge.chargeCode === 'RENT');
  const title =
    mode === 'preview'
      ? 'Xem trước hợp đồng'
      : mode === 'signing'
        ? 'Ký hợp đồng'
        : 'Tạo hợp đồng thuê';
  const termOptions =
    staff && preparation
      ? ([6, 12] as const).map((months) => ({
          label: months === 6 ? '6 tháng' : '1 năm',
          date: displayContractDate(endOfTerm(inputDate(start)!, months)),
        }))
      : [];
  const content = (
    <>
      {owner ? (
        <RentalContractStepper
          current={mode === 'signing' ? 1 : 0}
          steps={owner ? ownerContractSteps : undefined}
        />
      ) : (
        <Box>
          <MainContractProgress current={mode === 'edit' ? 3 : mode === 'preview' ? 4 : 5} />
        </Box>
      )}
      {loading && <ActivityIndicator accessibilityLabel="Đang tải dữ liệu hợp đồng" />}
      {!!error && !(owner && mode === 'preview' && documentBlocker) && (
        <ContractNotice message={error} />
      )}
      {!loading && !preparation && (
        <Button contentStyle={{ minHeight: 48 }} onPress={() => setRevision((v) => v + 1)}>
          Tải lại dữ liệu
        </Button>
      )}
      {preparation && (
        <>
          {staff ? (
            mode !== 'signing' && (
              <Box>
                <Heading title={`${preparation.locationName} · Phòng ${preparation.roomNumber}`} />
                {!!representative && <Text>Đại diện thuê: {representative.fullName}</Text>}
                {rent && <Text>Giá thuê: {formatDraftMoney(rent.rate)}/tháng</Text>}
                {mode === 'preview' && (
                  <Text>
                    Thời hạn: {start} – {end}
                  </Text>
                )}
              </Box>
            )
          ) : mode === 'edit' ? (
            <>
              {id && (
                <Box>
                  <Pill>{labels[saved?.status ?? 'Draft'] ?? saved?.status}</Pill>
                  <Text>Hồ sơ nháp đã lưu</Text>
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
                <Text style={styles.support}>Email sẽ được nhập khi gửi lời mời ký.</Text>
                {!staff && (
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
                )}
                {!!fieldErrors.phone && <Text style={styles.error}>{fieldErrors.phone}</Text>}
                {preparation.residents.some((person) => !person.representative) && (
                  <>
                    <Text style={styles.support}>Thành viên cùng ở · Đã lưu</Text>
                    {preparation.residents
                      .filter((person) => !person.representative)
                      .map((person) => (
                        <View key={person.id} style={{ gap: 4 }}>
                          <Text>
                            {person.fullName}
                            {person.relationship ? ` · ${person.relationship}` : ''}
                          </Text>
                          {!!person.dateOfBirth && (
                            <Text style={styles.support}>
                              Ngày sinh: {displayContractDate(person.dateOfBirth)}
                            </Text>
                          )}
                        </View>
                      ))}
                  </>
                )}
              </Box>
            </>
          ) : (
            <ContractPreviewSummary
              showSigner={!(owner && mode === 'signing')}
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
          {!staff && signingVisited && client && saved && (
            <View style={mode === 'signing' ? undefined : { display: 'none' }}>
              <MainDraftSigningReview
                key={`${id}:${saved.version}:${reviewRevision}`}
                client={client}
                draft={saved}
                onBusyChange={setBusy}
                onReleased={(next) => (onReleased ? onReleased(next) : onList())}
                onOpenPdf={(file) => openFile(true, file, true)}
                onDownloadPdf={(file) => openFile(true, file)}
                onEditDraft={
                  reviewOnly
                    ? undefined
                    : () => {
                        setDocuments(null);
                        setReadyFile('');
                        setSigningVisited(false);
                        setMode('edit');
                      }
                }
                onDraftChanged={(latest) => {
                  setDocuments(null);
                  setReadyFile('');
                  setSigningVisited(reviewOnly);
                  setSaved(latest);
                  setPreparation(latest.preparation);
                  refs.current = latest.input;
                  setStart(displayContractDate(latest.input.startDate));
                  setEnd(displayContractDate(latest.input.endDate));
                  setPhone(latest.input.tenantPhone);
                  setEmail(latest.input.tenantEmail ?? '');
                  setPlace(latest.input.tenantPlaceOfIssue);
                  setNotes(latest.input.notes);
                  dirty.current = false;
                  setMode(reviewOnly ? 'signing' : 'preview');
                }}
              />
            </View>
          )}
          {mode === 'edit' ? (
            <Box>
              <Heading title={staff ? 'Thời hạn thuê' : 'Điều khoản thuê'} />
              {staff ? (
                <>
                  <Button
                    mode="outlined"
                    icon={termOpen ? 'chevron-up' : 'chevron-down'}
                    accessibilityLabel="Kỳ thuê"
                    accessibilityState={{ expanded: termOpen }}
                    contentStyle={styles.termTrigger}
                    disabled={busy || readOnly}
                    onPress={() => setTermOpen((open) => !open)}
                  >
                    {termOptions.find((option) => option.date === end)?.label ?? 'Chọn kỳ thuê'}
                  </Button>
                  {termOpen && (
                    <View style={styles.termOptions}>
                      {termOptions.map((option) => (
                        <Button
                          key={option.label}
                          accessibilityState={{ selected: end === option.date }}
                          contentStyle={styles.termOption}
                          onPress={() => {
                            edit(setEnd)(option.date);
                            setTermOpen(false);
                          }}
                        >
                          {option.label}
                        </Button>
                      ))}
                    </View>
                  )}
                  <Text>
                    {start} – {end}
                  </Text>
                </>
              ) : (
                <>
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
                </>
              )}
              {!staff &&
                preparation.charges.map((p) => (
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
              {!staff && preparation.securityDeposit !== null && (
                <Row spread>
                  <Text>Tiền cọc</Text>
                  <Text>{formatDraftMoney(preparation.securityDeposit)}</Text>
                </Row>
              )}
              {!staff && !!preparation.paymentTerms && (
                <Text>Thanh toán: {preparation.paymentTerms}</Text>
              )}
              {!staff && (
                <>
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
                </>
              )}
            </Box>
          ) : mode === 'preview' && client ? (
            <ContractPdfPreview
              client={client}
              contractId={id}
              document={documents?.pdf ?? null}
              hideUnavailableActions={owner || staff}
              busy={busy}
              previewErrorCode={documentBlocker || documents?.previewError || null}
              hasDocx={!!documents?.docx}
              onRegenerate={() => void reviewSaved(false)}
              onOpenPdf={() => openFile(true, undefined, true)}
              onDownloadPdf={() => void openFile(true)}
              onDocumentError={invalidateDocument}
              onReady={setReadyFile}
              onOpenDocx={() => void openFile(false)}
            />
          ) : null}
        </>
      )}
    </>
  );
  const footer = !reviewOnly && (
    <View style={[styles.footer, onPrevious && { flexWrap: 'wrap' }, owner && styles.ownerFooter]}>
      {busy && <ActivityIndicator />}
      {!staff && onPrevious && mode === 'edit' && (
        <Button
          style={{ width: '100%' }}
          icon="arrow-left"
          disabled={busy || readOnly}
          onPress={back}
        >
          {'Quay l\u1ea1i: CCCD'}
        </Button>
      )}
      {mode === 'edit' ? (
        <>
          {!staff && (
            <Button
              contentStyle={{ minHeight: 48 }}
              mode="text"
              style={owner ? styles.ownerAction : styles.secondaryAction}
              disabled={
                busy || readOnly || loading || !preparation || !!preparation.blockers.length
              }
              onPress={() => void save(false)}
            >
              Lưu nháp
            </Button>
          )}
          <Button
            contentStyle={{ minHeight: 48 }}
            mode="contained"
            buttonColor={s.blue}
            style={owner ? styles.ownerAction : styles.primaryAction}
            disabled={busy || readOnly || loading || !preparation || !!preparation.blockers.length}
            onPress={() => void save(true)}
          >
            {staff ? 'Lưu hợp đồng' : 'Xem trước hợp đồng'}
          </Button>
        </>
      ) : (
        <>
          <Button
            style={owner ? styles.ownerAction : styles.primaryAction}
            labelStyle={{ fontSize: 12 }}
            contentStyle={{ minHeight: 48 }}
            disabled={busy || readOnly}
            onPress={() => (mode === 'preview' ? setMode('edit') : setMode('preview'))}
          >
            {mode === 'preview' ? 'Chỉnh sửa thông tin' : 'Xem hợp đồng'}
          </Button>
          {mode === 'preview' ? (
            <Button
              style={owner ? styles.ownerAction : styles.primaryAction}
              labelStyle={{ fontSize: 12 }}
              contentStyle={{ minHeight: 48 }}
              mode="contained"
              disabled={
                busy || readOnly || !documents?.pdf || (owner && readyFile !== documents.pdf.id)
              }
              onPress={() => void reviewSaved(true)}
            >
              {owner ? 'Tiếp tục duyệt hợp đồng' : 'Tiếp tục ký hợp đồng'}
            </Button>
          ) : !owner ? (
            <Button
              contentStyle={{ minHeight: 48 }}
              mode="contained"
              disabled={busy || readOnly}
              onPress={onList}
            >
              Về danh sách hợp đồng
            </Button>
          ) : null}
        </>
      )}
    </View>
  );
  if (staff)
    return visible ? (
      <View style={styles.inline}>
        <Row>
          <IconButton
            icon="arrow-left"
            accessibilityLabel={onPrevious && mode === 'edit' ? 'Quay lại: CCCD' : 'Quay lại'}
            onPress={back}
          />
          <Heading title={title} />
        </Row>
        {content}
        {footer}
      </View>
    ) : null;
  // The web modal inherits the app's safe-area context. A nested provider can measure
  // the opening animation as a full-height bottom inset and collapse the scroll area.
  const ModalSafeArea = Platform.OS === 'web' ? React.Fragment : SafeAreaProvider;
  return (
    <Modal
      visible={visible}
      presentationStyle="fullScreen"
      onRequestClose={back}
      animationType="slide"
    >
      <ModalSafeArea>
        <Portal.Host>
          <SafeAreaView edges={['top', 'bottom', 'left', 'right']} style={styles.root}>
            <View style={styles.header}>
              <IconButton
                icon="arrow-left"
                iconColor="#FFFFFF"
                accessibilityLabel={
                  reviewOnly ? 'Quay lại danh sách hợp đồng' : 'Quay lại tạo hợp đồng'
                }
                onPress={back}
              />
              <Text style={styles.title}>
                {mode === 'preview'
                  ? 'Xem trước hợp đồng'
                  : mode === 'signing'
                    ? owner
                      ? 'Duyệt & ký hợp đồng'
                      : 'Ký hợp đồng'
                    : 'Tạo hợp đồng thuê'}
              </Text>
            </View>
            <KeyboardAvoidingView
              style={styles.grow}
              behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            >
              <KeyboardFormScrollView
                ref={formScroll}
                style={styles.grow}
                contentContainerStyle={styles.content}
                keyboardShouldPersistTaps="handled"
              >
                {content}
              </KeyboardFormScrollView>
              {footer}
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
  inline: { gap: 12 },
  termTrigger: { flexDirection: 'row-reverse', justifyContent: 'space-between', minHeight: 48 },
  termOptions: { borderWidth: 1, borderColor: c.border, borderRadius: 10 },
  termOption: { justifyContent: 'flex-start', minHeight: 48 },
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
  ownerFooter: { flexDirection: 'column', alignItems: 'stretch' },
  ownerAction: { minWidth: 0, width: '100%', maxWidth: 696, alignSelf: 'center' },
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
