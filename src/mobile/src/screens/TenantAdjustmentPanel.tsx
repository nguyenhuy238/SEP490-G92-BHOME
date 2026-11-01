import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'react-native';
import { Checkbox, Text, TextInput } from 'react-native-paper';
import { randomUUID } from 'expo-crypto';
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
import { Action, Box, Heading, Pill, ui } from '../components/WorkspaceKit';
import { Pagination, QueryState } from '../components/WorkspaceQueryState';
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
  const list = useWorkspaceQuery<Page<Adjustment>>(
    `/api/v1/invoice-adjustments?invoiceId=${invoice.id}&page=${page}&pageSize=20`,
  );
  const effects = useWorkspaceQuery<Page<AdjustmentEffect>>(
    `/api/v1/invoices/${invoice.id}/adjustments?page=${effectPage}&pageSize=20`,
  );
  const detail = useWorkspaceQuery<Adjustment>(
    selected ? `/api/v1/invoice-adjustments/${selected}` : null,
  );
  if (!session?.roles.includes('Tenant') || !client) return null;
  return (
    <>
      <Box>
        <Heading
          title="Điều chỉnh hóa đơn"
          detail="Owner quyết định; yêu cầu và ảnh của bạn được giữ riêng tư."
        />
        <Action onPress={() => setOpen(!open)}>
          {open ? 'Đóng yêu cầu mới' : 'Yêu cầu điều chỉnh'}
        </Action>
        {open && (
          <RequestForm
            key={invoice.id + ':' + invoice.version}
            invoice={invoice}
            client={client}
            submitted={(id) => {
              setOpen(false);
              setSelected(id);
              list.reload();
              effects.reload();
            }}
          />
        )}
      </Box>
      <Box>
        <Heading title="Lịch sử yêu cầu của bạn" />
        <QueryState
          loading={list.loading || effects.loading}
          error={list.error || effects.error}
          reload={() => {
            list.reload();
            effects.reload();
            detail.reload();
          }}
        />
        {list.data?.items.length === 0 && <Text>Bạn chưa gửi yêu cầu cho hóa đơn này.</Text>}
        {list.data?.items.map((r) => (
          <React.Fragment key={r.id}>
            <Text>
              {adjustmentStatus(r.status)} · {r.chargeCode ?? 'Toàn hóa đơn'} ·{' '}
              {formatInstant(r.submittedAt)}
            </Text>
            <Action secondary onPress={() => setSelected(r.id)}>
              Xem yêu cầu của tôi
            </Action>
          </React.Fragment>
        ))}
        {list.data && (
          <Pagination
            page={page}
            total={list.data.totalCount}
            loading={list.loading}
            onChange={setPage}
          />
        )}
      </Box>
      {selected && (
        <Box>
          <Heading title="Kết quả yêu cầu" />
          <QueryState {...detail} />
          {detail.data && (
            <>
              <Pill>{adjustmentStatus(detail.data.status)}</Pill>
              <Text>Lý do: {detail.data.reason}</Text>
              <Text>
                Giá trị khi gửi: {formatContractMoney(detail.data.currentAmount)} · Đề xuất:{' '}
                {detail.data.proposedAmount === null
                  ? 'Không đề xuất'
                  : formatContractMoney(detail.data.proposedAmount)}
              </Text>
              {detail.data.decision && (
                <>
                  <Text>Quyết định Owner: {detail.data.decision.reason}</Text>
                  <Text>
                    {formatInstant(detail.data.decision.decidedAt)} · Thay đổi{' '}
                    {signedVnd(detail.data.decision.delta)}
                  </Text>
                </>
              )}
              {detail.data.financials && (
                <>
                  <Text>
                    Nghĩa vụ hiện hành:{' '}
                    {formatContractMoney(detail.data.financials.effectivePayableAmount)} · Còn phải
                    trả: {formatContractMoney(detail.data.financials.outstandingAmount)}
                  </Text>
                  {detail.data.financials.reviewStatus === 'PendingReview' && (
                    <Text style={ui.red}>
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
              <Action
                secondary
                onPress={() => {
                  detail.reload();
                  list.reload();
                  effects.reload();
                }}
              >
                Tải lại kết quả điều chỉnh
              </Action>
            </>
          )}
        </Box>
      )}
      <Box>
        <Heading title="Điều chỉnh đã duyệt của hóa đơn" />
        {effects.data?.items.length === 0 && <Text>Chưa có điều chỉnh được duyệt.</Text>}
        {effects.data?.items.map((e) => (
          <Text key={e.id}>
            {e.invoiceStatus === 'Draft'
              ? 'Đã áp dụng trước phát hành'
              : 'Điều chỉnh sau phát hành'}{' '}
            · {e.chargeCode ?? 'Toàn hóa đơn'} · {signedVnd(e.delta)} · {formatInstant(e.decidedAt)}
          </Text>
        ))}
        {effects.data && (
          <Pagination
            page={effectPage}
            total={effects.data.totalCount}
            loading={effects.loading}
            onChange={setEffectPage}
          />
        )}
      </Box>
    </>
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
    [error, setError] = useState('');
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
      submitted(result.id);
    } catch (e) {
      setError(adjustmentError(e));
    } finally {
      lock.current = false;
      setBusy(false);
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
      <CameraCapture
        label="Chụp ảnh bằng chứng điều chỉnh"
        disabled={!checked || busy || uploading || evidence.length >= 5}
        reviewBeforeSubmit
        reviewActionLabel="Tải bằng chứng điều chỉnh"
        reviewNotice="Ảnh được lưu private cùng yêu cầu điều chỉnh. Kiểm tra nội dung trước khi tải."
        onCapture={async (bytes) => {
          if (uploadLock.current) return;
          uploadLock.current = true;
          setUploading(true);
          setError('');
          try {
            if (bytes.byteLength > 5 * 1024 * 1024) {
              setError('Ảnh vượt quá 5 MB.');
              return;
            }
            const result = await client.upload(invoice.id, bytes, 'image/jpeg');
            setEvidence((ids) => [...ids, result.id]);
            changed();
          } catch (e) {
            setError(adjustmentError(e));
          } finally {
            uploadLock.current = false;
            setUploading(false);
          }
        }}
      />
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
    [error, setError] = useState(''),
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
