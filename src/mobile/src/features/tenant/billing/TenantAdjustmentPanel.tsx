import { useFeedbackState } from '../../../lib/useFeedbackState';
import { showSuccess } from '../../../lib/toast';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import {
  Button,
  IconButton,
  Checkbox,
  Portal,
  Text,
  TextInput,
  TouchableRipple,
} from 'react-native-paper';
import { randomUUID } from '../../../lib/randomUUID';
import {
  adjustmentClient,
  adjustmentError,
  adjustmentStatus,
  signedVnd,
  type Adjustment,
  type AdjustmentEffect,
} from '../../../../../../packages/client-core/src/adjustments';
import { formatContractMoney, vnd } from '../../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import type { Invoice, Page } from '../../../../../../packages/client-core/src/invoices';
import { Action, Pill, ui } from '../../../components/WorkspaceKit';
import { MoneyTextInput } from '../../../components/MoneyTextInput';
import {
  InvoiceFeedback,
  InvoiceMoneyRow,
  InvoicePager,
  invoiceUi,
} from '../../../components/InvoiceDetailUi';
import { loadAdjustmentPage, loadTenantAdjustment } from '../../../services/tenantInvoices';
import { ChoiceField } from '../../../components/WorkflowControls';
import { CameraCapture } from '../../../components/CameraCapture';
import { FloatingDemoPhotoButton } from '../../../components/FloatingDemoPhotoButton';
import { canUseLocalMeterDemo, meterDemoJpegBytes } from '../../../lib/meterDemoCapture';
import { useSession } from '../../../lib/SessionProvider';
import { useWorkspaceQuery } from '../../workspace/useWorkspaceQuery';
import { colors } from '../../../theme/theme';
import { ToastHost } from '../../../components/ToastHost';

const adjustmentTone = (status: string) =>
  status === 'Approved'
    ? 'green'
    : status === 'Rejected'
      ? 'red'
      : status === 'Pending'
        ? 'amber'
        : 'neutral';

export function TenantAdjustmentPanel({
  invoice,
  compact = false,
  initialOpen = false,
  historyOnly = false,
  canSubmit = true,
}: {
  invoice: Invoice;
  compact?: boolean;
  initialOpen?: boolean;
  historyOnly?: boolean;
  canSubmit?: boolean;
}) {
  const { api, session } = useSession();
  const client = useMemo(() => (api ? adjustmentClient(api.request.bind(api)) : null), [api]);
  const [page, setPage] = useState(1),
    [effectPage, setEffectPage] = useState(1),
    [selected, setSelected] = useState(''),
    [open, setOpen] = useState(initialOpen);
  const [tab, setTab] = useState<'requests' | 'approved'>('requests');
  const [modal, setModal] = useState<'requests' | 'new' | null>(null);
  const [formBusy, setFormBusy] = useState(false);
  if (modal === 'new' && !canSubmit && !formBusy) {
    setModal(null);
  }
  const closeModal = () => {
    if (!formBusy) setModal(null);
  };
  const allowed = session?.roles.includes('Tenant') && !!client;
  const list = useWorkspaceQuery<Page<Adjustment>>(
    allowed
      ? `/api/v1/invoice-adjustments?invoiceId=${encodeURIComponent(invoice.id)}&page=${page}&pageSize=20`
      : null,
    { load: loadAdjustmentPage<Adjustment>, notifyError: false },
  );
  const effects = useWorkspaceQuery<Page<AdjustmentEffect>>(
    allowed && !compact
      ? `/api/v1/invoices/${encodeURIComponent(invoice.id)}/adjustments?page=${effectPage}&pageSize=20`
      : null,
    { load: loadAdjustmentPage<AdjustmentEffect>, notifyError: false },
  );
  const detail = useWorkspaceQuery<Adjustment>(
    allowed && selected && tab === 'requests'
      ? `/api/v1/invoice-adjustments/${encodeURIComponent(selected)}`
      : null,
    { load: loadTenantAdjustment, notifyError: false },
  );
  const current = tab === 'requests' ? list : effects;
  if (!allowed || !client) return null;
  if (compact)
    return (
      <View style={invoiceUi.card}>
        <Text style={invoiceUi.heading}>Điều chỉnh hóa đơn</Text>
        <InvoiceFeedback {...list} />
        {list.data && !list.error && (
          <View style={invoiceUi.row}>
            <Text style={invoiceUi.secondary}>{list.data.totalCount} yêu cầu</Text>
            {list.data.items[0] && (
              <Pill tone={adjustmentTone(list.data.items[0].status)}>
                {adjustmentStatus(list.data.items[0].status)}
              </Pill>
            )}
          </View>
        )}
        <View style={invoiceUi.row}>
          <Button contentStyle={{ minHeight: 44 }} onPress={() => setModal('requests')}>
            Xem yêu cầu
          </Button>
          {canSubmit && (
            <Button contentStyle={{ minHeight: 44 }} onPress={() => setModal('new')}>
              Gửi yêu cầu điều chỉnh
            </Button>
          )}
        </View>
        {modal && (modal === 'requests' || canSubmit || formBusy) && (
          <Modal transparent visible animationType="fade" onRequestClose={closeModal}>
            <Portal.Host>
              <KeyboardAvoidingView
                style={modalStyles.backdrop}
                behavior={
                  Platform.OS === 'ios'
                    ? 'padding'
                    : Platform.OS === 'android'
                      ? 'height'
                      : undefined
                }
              >
                <View style={modalStyles.card} accessibilityViewIsModal>
                  <View style={modalStyles.header}>
                    <Text style={[invoiceUi.heading, { flex: 1 }]}>
                      {modal === 'new' ? 'Gửi yêu cầu điều chỉnh' : 'Yêu cầu điều chỉnh'}
                    </Text>
                    <IconButton
                      icon="close"
                      accessibilityLabel="Đóng yêu cầu điều chỉnh"
                      disabled={formBusy}
                      onPress={closeModal}
                    />
                  </View>
                  <ScrollView
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={
                      modal === 'requests' ? modalStyles.historyContent : modalStyles.content
                    }
                  >
                    {modal === 'new' ? (
                      <RequestForm
                        key={invoice.id + ':' + invoice.version}
                        invoice={invoice}
                        client={client}
                        onBusyChange={setFormBusy}
                        submitted={() => {
                          setModal(null);
                          list.reload();
                        }}
                      />
                    ) : (
                      <TenantAdjustmentPanel invoice={invoice} historyOnly />
                    )}
                  </ScrollView>
                </View>
                <ToastHost modal />
              </KeyboardAvoidingView>
            </Portal.Host>
          </Modal>
        )}
      </View>
    );
  return (
    <View
      style={
        historyOnly ? modalStyles.historySection : [invoiceUi.section, { borderBottomWidth: 0 }]
      }
    >
      {!historyOnly && <Text style={invoiceUi.heading}>Điều chỉnh hóa đơn</Text>}
      {!historyOnly && canSubmit && open && (
        <RequestForm
          key={invoice.id + ':' + invoice.version}
          invoice={invoice}
          client={client}
          submitted={(id) => {
            setOpen(false);
            setTab('requests');
            setSelected(id);
            list.reload();
            effects.reload();
          }}
        />
      )}
      <View style={invoiceUi.tabBar}>
        <TouchableRipple
          style={[invoiceUi.tab, tab === 'requests' && invoiceUi.tabActive]}
          accessibilityRole="tab"
          accessibilityLabel="Yêu cầu của tôi"
          accessibilityState={{ selected: tab === 'requests' }}
          onPress={() => setTab('requests')}
        >
          <Text style={[invoiceUi.tabText, tab === 'requests' && invoiceUi.tabTextActive]}>
            Yêu cầu của tôi ({list.error ? '—' : (list.data?.totalCount ?? '…')})
          </Text>
        </TouchableRipple>
        <TouchableRipple
          style={[invoiceUi.tab, tab === 'approved' && invoiceUi.tabActive]}
          accessibilityRole="tab"
          accessibilityLabel="Đã duyệt"
          accessibilityState={{ selected: tab === 'approved' }}
          onPress={() => setTab('approved')}
        >
          <Text style={[invoiceUi.tabText, tab === 'approved' && invoiceUi.tabTextActive]}>
            Đã duyệt ({effects.error ? '—' : (effects.data?.totalCount ?? '…')})
          </Text>
        </TouchableRipple>
      </View>
      <InvoiceFeedback {...current} />
      {tab === 'requests' && (
        <>
          {list.data?.items.length === 0 && (
            <Text style={invoiceUi.secondary}>Chưa có yêu cầu điều chỉnh.</Text>
          )}
          {list.data?.items.map((r) => (
            <View key={r.id} style={invoiceUi.divider}>
              <View style={invoiceUi.row}>
                <Pill tone={adjustmentTone(r.status)}>{adjustmentStatus(r.status)}</Pill>
                <Text variant="bodySmall" style={ui.muted}>
                  {formatInstant(r.submittedAt)}
                </Text>
              </View>
              <Button compact onPress={() => setSelected(r.id)}>
                Xem yêu cầu của tôi
              </Button>
            </View>
          ))}
          {list.data && (
            <InvoicePager
              page={page}
              total={list.data.totalCount}
              loading={list.loading}
              onChange={setPage}
            />
          )}
        </>
      )}
      {tab === 'approved' && (
        <>
          {effects.data?.items.length === 0 && (
            <Text style={invoiceUi.secondary}>Chưa có điều chỉnh được duyệt.</Text>
          )}
          {effects.data?.items.map((e) => (
            <View key={e.id} style={invoiceUi.divider}>
              <View style={invoiceUi.row}>
                <Text style={ui.grow}>
                  {e.invoiceStatus === 'Draft'
                    ? 'Đã áp dụng trước phát hành'
                    : 'Điều chỉnh sau phát hành'}
                </Text>
                <Text style={invoiceUi.amount}>{signedVnd(e.delta)}</Text>
              </View>
              <Text variant="bodySmall" style={ui.muted}>
                {formatInstant(e.decidedAt)}
              </Text>
            </View>
          ))}
          {effects.data && (
            <InvoicePager
              page={effectPage}
              total={effects.data.totalCount}
              loading={effects.loading}
              onChange={setEffectPage}
            />
          )}
        </>
      )}
      {!historyOnly && canSubmit && (
        <Button
          compact
          mode="text"
          icon={open ? 'close' : 'plus'}
          style={invoiceUi.inlineAction}
          onPress={() => setOpen(!open)}
        >
          {open ? 'Đóng yêu cầu mới' : 'Gửi yêu cầu điều chỉnh'}
        </Button>
      )}
      {!!selected && tab === 'requests' && (
        <View style={invoiceUi.divider}>
          <View style={invoiceUi.row}>
            <Text variant="titleSmall">Kết quả yêu cầu</Text>
            <IconButton
              icon="close"
              accessibilityLabel="Đóng chi tiết yêu cầu"
              onPress={() => setSelected('')}
            />
          </View>
          <InvoiceFeedback {...detail} />
          {detail.data && (
            <>
              <Pill tone={adjustmentTone(detail.data.status)}>
                {adjustmentStatus(detail.data.status)}
              </Pill>
              <Text>Lý do: {detail.data.reason}</Text>
              <InvoiceMoneyRow label="Giá trị khi gửi" value={detail.data.currentAmount} />
              {detail.data.proposedAmount === null ? (
                <Text style={ui.muted}>Không đề xuất số tiền.</Text>
              ) : (
                <InvoiceMoneyRow label="Giá trị đề xuất" value={detail.data.proposedAmount} />
              )}
              {detail.data.decision && (
                <>
                  <Text>Quyết định Owner: {detail.data.decision.reason}</Text>
                  <Text variant="bodySmall" style={ui.muted}>
                    {formatInstant(detail.data.decision.decidedAt)} · Thay đổi{' '}
                    {signedVnd(detail.data.decision.delta)}
                  </Text>
                </>
              )}
              {detail.data.financials && (
                <>
                  <InvoiceMoneyRow
                    label="Số tiền phải thanh toán"
                    value={detail.data.financials.effectivePayableAmount}
                  />
                  <InvoiceMoneyRow
                    label="Còn phải trả"
                    value={detail.data.financials.outstandingAmount}
                  />
                  {detail.data.financials.reviewStatus === 'PendingReview' && (
                    <Text style={ui.muted}>
                      Tiền thừa chờ xem xét:{' '}
                      {formatContractMoney(detail.data.financials.potentialExcessAmount)}. Chưa hoàn
                      tiền hoặc chuyển credit.
                    </Text>
                  )}
                </>
              )}
              {detail.data.evidence.map((e, index) => (
                <AdjustmentEvidenceImage
                  key={e.id}
                  client={client}
                  id={selected}
                  fileId={e.id}
                  mime={e.contentType}
                  number={index + 1}
                />
              ))}
            </>
          )}
        </View>
      )}
    </View>
  );
}
const modalStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,22,55,0.48)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  card: {
    width: '100%',
    maxWidth: 480,
    maxHeight: '92%',
    backgroundColor: colors.white,
    borderRadius: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  content: { padding: 16, gap: 12 },
  historyContent: { paddingHorizontal: 16, paddingTop: 4, paddingBottom: 12 },
  historySection: { gap: 10 },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoTile: { width: '47%', maxWidth: 175, minWidth: 104, flexGrow: 1 },
  photo: { width: '100%', height: 110, borderRadius: 10 },
  removePhoto: {
    position: 'absolute',
    top: 0,
    right: 0,
    margin: 2,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.white,
  },
});
function evidencePreviewUri(bytes: Uint8Array, mime: string) {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
type AdjustmentClient = ReturnType<typeof adjustmentClient>;
function RequestForm({
  invoice,
  client,
  submitted,
  onBusyChange,
}: {
  invoice: Invoice;
  client: AdjustmentClient;
  submitted: (id: string) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [line, setLine] = useState(''),
    [amount, setAmount] = useState(''),
    [reason, setReason] = useState(''),
    [evidence, setEvidence] = useState<{ id: string; uri: string }[]>([]),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useFeedbackState();
  const key = useRef(randomUUID()),
    lock = useRef(false),
    uploadLock = useRef(false);
  const canUseSample = canUseLocalMeterDemo(
    typeof __DEV__ !== 'undefined' && __DEV__,
    Platform.OS,
    globalThis.location?.hostname,
    globalThis.location?.port,
  );
  const photoDisabled = !checked || busy || uploading || evidence.length >= 5;
  const changed = () => {
    key.current = randomUUID();
  };
  async function submit() {
    if (lock.current) return;
    try {
      if (!reason.trim() || reason.trim().length > 2000) throw new Error();
      if (amount) vnd(amount);
    } catch {
      setError('Nhập lý do và số nguyên VND hợp lệ nếu đề xuất giá trị.');
      return;
    }
    lock.current = true;
    onBusyChange?.(true);
    setBusy(true);
    setError('');
    try {
      const result = await client.submit(
        invoice.id,
        {
          invoiceLineId: line || null,
          proposedAmount: amount || null,
          reason: reason.trim(),
          evidenceIds: evidence.map((photo) => photo.id),
          expectedInvoiceVersion: invoice.version,
        },
        key.current,
      );
      showSuccess('Đã gửi yêu cầu điều chỉnh. Chờ Owner xem xét.');
      submitted(result.id);
    } catch (e) {
      setError(adjustmentError(e));
    } finally {
      lock.current = false;
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  async function uploadEvidence(bytes: Uint8Array<ArrayBuffer>, mime = 'image/jpeg') {
    if (uploadLock.current || lock.current || photoDisabled) return false;
    uploadLock.current = true;
    onBusyChange?.(true);
    setUploading(true);
    setError('');
    try {
      if (bytes.byteLength > 5 * 1024 * 1024) {
        setError('Ảnh vượt quá 5 MB.');
        return false;
      }
      const uri = evidencePreviewUri(bytes, mime);
      const result = await client.upload(invoice.id, bytes, mime);
      setEvidence((photos) => [...photos, { id: result.id, uri }]);
      changed();
      return true;
    } catch (e) {
      setError(adjustmentError(e));
      return false;
    } finally {
      uploadLock.current = false;
      setUploading(false);
      onBusyChange?.(false);
    }
  }
  async function addSamplePhoto() {
    if (!canUseSample || photoDisabled || uploadLock.current || lock.current) return;
    let bytes: Uint8Array<ArrayBuffer> | undefined;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 480;
      const context = canvas.getContext('2d');
      if (!context) throw new Error();
      context.fillStyle = '#edf2f9';
      context.fillRect(0, 0, 800, 480);
      context.fillStyle = '#172b4d';
      context.font = 'bold 40px sans-serif';
      context.fillText('BHOME - ẢNH MẪU DEV', 36, 160);
      context.font = 'bold 28px sans-serif';
      context.fillText('KHÔNG PHẢI BẰNG CHỨNG THỰC TẾ', 36, 240);
      context.font = '24px sans-serif';
      context.fillText('Chỉ dùng thử điều chỉnh hóa đơn', 36, 310);
      bytes = meterDemoJpegBytes(canvas.toDataURL('image/jpeg', 0.85));
      await uploadEvidence(bytes);
    } catch {
      setError('Không tạo được ảnh mẫu DEV. Hãy thử lại.');
    } finally {
      bytes?.fill(0);
    }
  }
  return (
    <>
      <ChoiceField
        label="Khoản phí cần xem xét"
        value={line}
        disabled={busy || uploading}
        options={[
          { id: '', label: 'Yêu cầu chung / toàn hóa đơn' },
          ...invoice.lines.map((l) => ({
            id: l.id,
            label: l.name + ' · ' + formatContractMoney(l.amount),
          })),
        ]}
        onChange={(id) => {
          setLine(id);
          changed();
        }}
      />
      <MoneyTextInput
        label="Giá trị đề xuất (VND, tùy chọn)"
        accessibilityLabel="Giá trị đề xuất (VND, tùy chọn)"
        value={amount}
        disabled={busy}
        onChangeText={(v) => {
          setAmount(v);
          changed();
        }}
      />
      <TextInput
        label="Lý do yêu cầu điều chỉnh"
        accessibilityLabel="Lý do yêu cầu điều chỉnh"
        value={reason}
        multiline
        maxLength={2000}
        disabled={busy}
        onChangeText={(v) => {
          setReason(v);
          changed();
        }}
      />
      <Checkbox.Item
        label="Tôi đã kiểm tra ảnh bằng chứng"
        status={checked ? 'checked' : 'unchecked'}
        disabled={busy || uploading}
        onPress={() => setChecked(!checked)}
      />
      <CameraCapture
        label="Chụp ảnh"
        presentation="evidence"
        disabled={photoDisabled}
        reviewBeforeSubmit
        onCapture={uploadEvidence}
      />
      {canUseSample && (
        <FloatingDemoPhotoButton disabled={photoDisabled} onPress={() => void addSamplePhoto()} />
      )}
      <Text>Đã tải {evidence.length}/5 ảnh.</Text>
      {evidence.length > 0 && (
        <View style={modalStyles.photoGrid}>
          {evidence.map((photo, index) => (
            <View key={photo.id} style={modalStyles.photoTile}>
              <Image
                source={{ uri: photo.uri }}
                resizeMode="cover"
                accessibilityLabel={`Ảnh bằng chứng ${index + 1}`}
                style={modalStyles.photo}
              />
              <IconButton
                icon="close"
                size={18}
                accessibilityLabel={`Xóa ảnh bằng chứng ${index + 1}`}
                disabled={busy || uploading}
                onPress={() => {
                  if (lock.current || uploadLock.current) return;
                  setEvidence((photos) => photos.filter((entry) => entry.id !== photo.id));
                  changed();
                }}
                style={modalStyles.removePhoto}
              />
            </View>
          ))}
        </View>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
      <Action disabled={busy || uploading || !reason.trim()} onPress={() => void submit()}>
        Gửi yêu cầu cho Owner
      </Action>
      <Text>Đề xuất chưa thay đổi số tiền. Owner cần xem xét và quyết định.</Text>
    </>
  );
}
export function AdjustmentEvidenceImage({
  client,
  id,
  fileId,
  mime,
  number,
}: {
  client: AdjustmentClient;
  id: string;
  fileId: string;
  mime: string;
  number: number;
}) {
  const [uri, setUri] = useState(''),
    [error, setError] = useFeedbackState(),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  return (
    <>
      <Action
        secondary
        disabled={busy || !!uri}
        onPress={() => {
          if (lock.current) return;
          lock.current = true;
          setBusy(true);
          setError('');
          const controller = new AbortController();
          abort.current = controller;
          void client
            .evidenceBytes(id, fileId, controller.signal)
            .then((bytes) => {
              if (controller.signal.aborted) return;
              let binary = '';
              for (let offset = 0; offset < bytes.length; offset += 8192)
                binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
              setUri(`data:${mime};base64,${btoa(binary)}`);
            })
            .catch((e) => {
              if (!controller.signal.aborted) setError(adjustmentError(e));
            })
            .finally(() => {
              lock.current = false;
              if (!controller.signal.aborted) setBusy(false);
            });
        }}
      >
        Xem bằng chứng {number}
      </Action>
      {!!error && <Text style={ui.red}>{error}</Text>}
      {!!uri && (
        <Image
          source={{ uri }}
          accessibilityLabel={`Bằng chứng điều chỉnh ${number}`}
          style={{ width: '100%', height: 260 }}
          resizeMode="contain"
        />
      )}
    </>
  );
}
