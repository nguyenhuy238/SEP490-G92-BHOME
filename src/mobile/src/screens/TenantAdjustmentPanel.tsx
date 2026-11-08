import { useFeedbackState } from '../lib/useFeedbackState';
import { showSuccess } from '../lib/toast';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, Platform, View } from 'react-native';
import { Button, IconButton, Checkbox, Text, TextInput, TouchableRipple } from 'react-native-paper';
import { randomUUID } from '../lib/randomUUID';
import {
  adjustmentClient,
  adjustmentError,
  adjustmentStatus,
  signedVnd,
  type Adjustment,
  type AdjustmentEffect,
} from '../../../../packages/client-core/src/adjustments';
import { formatContractMoney, vnd } from '../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import type { Invoice, Page } from '../../../../packages/client-core/src/invoices';
import { Action, Pill, ui } from '../components/WorkspaceKit';
import {
  InvoiceFeedback,
  InvoiceMoneyRow,
  InvoicePager,
  invoiceUi,
} from '../components/InvoiceDetailUi';
import { loadAdjustmentPage, loadTenantAdjustment } from '../services/tenantInvoices';
import { ChoiceField } from '../components/WorkflowControls';
import { CameraCapture } from '../components/CameraCapture';
import { useSession } from '../lib/SessionProvider';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';

export function TenantAdjustmentPanel({ invoice }: { invoice: Invoice }) {
  const { api, session } = useSession();
  const client = useMemo(() => (api ? adjustmentClient(api.request.bind(api)) : null), [api]);
  const [page, setPage] = useState(1),
    [effectPage, setEffectPage] = useState(1),
    [selected, setSelected] = useState(''),
    [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'requests' | 'approved'>('requests');
  const allowed = session?.roles.includes('Tenant') && !!client;
  const list = useWorkspaceQuery<Page<Adjustment>>(
    allowed
      ? `/api/v1/invoice-adjustments?invoiceId=${encodeURIComponent(invoice.id)}&page=${page}&pageSize=20`
      : null,
    { load: loadAdjustmentPage<Adjustment>, notifyError: false },
  );
  const effects = useWorkspaceQuery<Page<AdjustmentEffect>>(
    allowed
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
  return (
    <View style={[invoiceUi.section, { borderBottomWidth: 0 }]}>
      <Text style={invoiceUi.heading}>Điều chỉnh hóa đơn</Text>
      {open && (
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
                <Pill>{adjustmentStatus(r.status)}</Pill>
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
      <Button
        compact
        mode="text"
        icon={open ? 'close' : 'plus'}
        style={invoiceUi.inlineAction}
        onPress={() => setOpen(!open)}
      >
        {open ? 'Đóng yêu cầu mới' : 'Gửi yêu cầu điều chỉnh'}
      </Button>
      {selected && tab === 'requests' && (
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
              <Pill>{adjustmentStatus(detail.data.status)}</Pill>
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
                <PrivateImage
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
type AdjustmentClient = ReturnType<typeof adjustmentClient>;
function RequestForm({
  invoice,
  client,
  submitted,
}: {
  invoice: Invoice;
  client: AdjustmentClient;
  submitted: (id: string) => void;
}) {
  const [line, setLine] = useState(''),
    [amount, setAmount] = useState(''),
    [reason, setReason] = useState(''),
    [evidence, setEvidence] = useState<string[]>([]),
    [checked, setChecked] = useState(false),
    [busy, setBusy] = useState(false),
    [uploading, setUploading] = useState(false),
    [error, setError] = useFeedbackState();
  const key = useRef(randomUUID()),
    lock = useRef(false),
    uploadLock = useRef(false);
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
    setBusy(true);
    setError('');
    try {
      const result = await client.submit(
        invoice.id,
        {
          invoiceLineId: line || null,
          proposedAmount: amount || null,
          reason: reason.trim(),
          evidenceIds: evidence,
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
    }
  }
  async function uploadEvidence(bytes: Uint8Array<ArrayBuffer>, mime = 'image/jpeg') {
    if (uploadLock.current) return;
    uploadLock.current = true;
    setUploading(true);
    setError('');
    try {
      if (bytes.byteLength > 5 * 1024 * 1024) {
        setError('Ảnh vượt quá 5 MB.');
        return;
      }
      const result = await client.upload(invoice.id, bytes, mime);
      setEvidence((ids) => [...ids, result.id]);
      changed();
    } catch (e) {
      setError(adjustmentError(e));
    } finally {
      uploadLock.current = false;
      setUploading(false);
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
      <TextInput
        label="Giá trị đề xuất (VND, tùy chọn)"
        accessibilityLabel="Giá trị đề xuất (VND, tùy chọn)"
        value={amount}
        keyboardType="number-pad"
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
      <Text>
        Ảnh bằng chứng liên quan khoản tranh chấp, tối đa 5 ảnh × 5 MB. Không chụp giấy tờ cá nhân.
      </Text>
      <Checkbox.Item
        label="Tôi đã kiểm tra ảnh bằng chứng"
        status={checked ? 'checked' : 'unchecked'}
        disabled={busy || uploading}
        onPress={() => setChecked(!checked)}
      />
      {Platform.OS === 'web' ? (
        <WebEvidencePicker
          disabled={!checked || busy || uploading || evidence.length >= 5}
          upload={uploadEvidence}
        />
      ) : (
        <CameraCapture
          label="Chụp ảnh bằng chứng điều chỉnh"
          disabled={!checked || busy || uploading || evidence.length >= 5}
          reviewBeforeSubmit
          reviewActionLabel="Tải bằng chứng điều chỉnh"
          reviewNotice="Ảnh được lưu private cùng yêu cầu điều chỉnh. Kiểm tra nội dung trước khi tải."
          onCapture={uploadEvidence}
        />
      )}
      <Text>Đã tải {evidence.length}/5 ảnh.</Text>
      {evidence.map((id, index) => (
        <Action
          key={id}
          secondary
          disabled={busy || uploading}
          onPress={() => {
            setEvidence((ids) => ids.filter((x) => x !== id));
            changed();
          }}
        >
          Bỏ ảnh {index + 1}
        </Action>
      ))}
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
function WebEvidencePicker({
  disabled,
  upload,
}: {
  disabled: boolean;
  upload: (bytes: Uint8Array<ArrayBuffer>, mime: string) => Promise<void>;
}) {
  const [file, setFile] = useState<File | null>(null),
    [url, setUrl] = useState(''),
    [error, setError] = useFeedbackState(),
    [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement | null>(null),
    lock = useRef(false);
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg"
        capture="environment"
        aria-label="Chọn ảnh bằng chứng điều chỉnh"
        disabled={disabled || busy}
        onChange={(event) => {
          const selected = event.currentTarget.files?.[0];
          setError('');
          setFile(null);
          setUrl('');
          if (!selected) return;
          if (
            selected.size > 5 * 1024 * 1024 ||
            !['image/png', 'image/jpeg'].includes(selected.type)
          ) {
            setError('Chọn PNG/JPEG tối đa 5 MB.');
            event.currentTarget.value = '';
            return;
          }
          setFile(selected);
          setUrl(URL.createObjectURL(selected));
        }}
      />
      {url && (
        <Image
          source={{ uri: url }}
          accessibilityLabel="Xem trước ảnh điều chỉnh"
          style={{ width: '100%', height: 240 }}
          resizeMode="contain"
        />
      )}
      {!!error && <Text style={ui.red}>{error}</Text>}
      {file && (
        <Action
          disabled={disabled || busy}
          onPress={() => {
            if (lock.current) return;
            lock.current = true;
            setBusy(true);
            setError('');
            void (async () => {
              let bytes: Uint8Array<ArrayBuffer> | null = null;
              try {
                bytes = new Uint8Array(await file.arrayBuffer());
                await upload(bytes, file.type);
              } catch {
                setError('Không đọc được ảnh. Chọn lại ảnh để thử.');
              } finally {
                bytes?.fill(0);
                setFile(null);
                setUrl('');
                if (input.current) input.current.value = '';
                lock.current = false;
                setBusy(false);
              }
            })();
          }}
        >
          Tải bằng chứng điều chỉnh
        </Action>
      )}
    </>
  );
}
function PrivateImage({
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
        Xem bằng chứng của tôi {number}
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
