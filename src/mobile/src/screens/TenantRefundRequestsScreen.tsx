import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Button, Checkbox, Text, TextInput } from 'react-native-paper';
import { formatContractMoney } from '../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { MoneyTextInput } from '../components/MoneyTextInput';
import { ChoiceField } from '../components/WorkflowControls';
import { Action, Box, Heading, Pill, Row, ui } from '../components/WorkspaceKit';
import { Pagination, QueryState } from '../components/WorkspaceQueryState';
import { useWorkspaceHeaderRefresh } from '../components/WorkspaceHeaderContext';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useSession } from '../lib/SessionProvider';
import { errorMessage } from '../lib/api';
import { ocrPreview } from '../lib/automaticOcr';
import { randomUUID } from '../lib/randomUUID';
import {
  createTenantRefundRequest,
  loadTenantRefundRequestSources,
  loadTenantRefundRequests,
  refundRequestFormError,
  tenantRefundRequestPath,
  tenantRefundRequestRoot,
  type TenantRefundRequest,
  type TenantRefundRequestInput,
} from '../services/tenantRefundRequests';
import type { Page } from '../../../../packages/client-core/src/invoices';

const statusLabels = {
  REQUESTED: 'Chờ Owner xem xét',
  APPROVED: 'Đã duyệt · chờ chuyển khoản',
  REJECTED: 'Đã từ chối',
  COMPLETED: 'Đã hoàn tiền',
} as const;

export function TenantRefundRequestsScreen() {
  const { session } = useSession();
  if (!session?.roles.includes('Tenant'))
    return <Text>Tài khoản không có quyền xem yêu cầu hoàn tiền Tenant.</Text>;
  return <TenantRefundRequests key={session.userId} />;
}

function TenantRefundRequests() {
  const { api } = useSession();
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [paymentId, setPaymentId] = useState('');
  const [contractId, setContractId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const inFlight = useRef(false);
  const key = useRef(randomUUID());
  const requests = useWorkspaceQuery<Page<TenantRefundRequest>>(tenantRefundRequestPath(page), {
    load: loadTenantRefundRequests,
    notifyError: false,
  });
  const sources = useWorkspaceQuery(formOpen ? `${tenantRefundRequestRoot}/sources` : null, {
    load: loadTenantRefundRequestSources,
    notifyError: false,
  });
  const reloadRequests = requests.reload;
  const reloadSources = sources.reload;
  const refresh = useCallback(() => {
    reloadRequests();
    reloadSources();
  }, [reloadRequests, reloadSources]);
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  useWorkspaceHeaderRefresh(refresh, requests.loading || sources.loading, {
    title: 'Yêu cầu hoàn tiền',
  });

  const update = () => {
    key.current = randomUUID();
    setError('');
    setSuccess('');
  };
  async function submit() {
    if (!api || inFlight.current) return;
    if (
      (paymentId && !sources.data?.payments.some((item) => item.id === paymentId)) ||
      (contractId && !sources.data?.contracts.some((item) => item.id === contractId))
    ) {
      setError('Chọn một giao dịch hoặc hợp đồng từ danh sách của bạn.');
      return;
    }
    if (!confirmed) {
      setError('Xác nhận số tiền và lý do trước khi gửi Owner.');
      return;
    }
    const input: TenantRefundRequestInput = {
      amount,
      reason,
      sourcePaymentId: paymentId || null,
      sourceContractId: contractId || null,
    };
    const validation = refundRequestFormError(input);
    if (validation) {
      setError(validation);
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const created = await createTenantRefundRequest(api, input, key.current);
      setSuccess(
        `Đã gửi yêu cầu ${created.id.slice(0, 8).toUpperCase()}. Owner sẽ xem xét và phản hồi.`,
      );
      setFormOpen(false);
      setAmount('');
      setReason('');
      setPaymentId('');
      setContractId('');
      setConfirmed(false);
      key.current = randomUUID();
      setPage(1);
      refresh();
    } catch (cause) {
      setError(
        `${errorMessage(cause)} Nếu chưa rõ kết quả, hãy tải lại lịch sử trước khi gửi lại.`,
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: 14 }}>
      <Box>
        <Heading
          title="Yêu cầu hoàn tiền"
          detail="Gửi trực tiếp tới Owner và theo dõi quyết định"
        />
        <Text style={ui.muted}>
          Có thể đề nghị hoàn tiền độc lập, hoặc liên kết một giao dịch hay hợp đồng của bạn để
          Owner dễ kiểm tra. Yêu cầu chỉ được ghi nhận sau khi máy chủ xác nhận.
        </Text>
        <Action
          icon={formOpen ? 'chevron-up' : 'cash-refund'}
          onPress={() => setFormOpen(!formOpen)}
        >
          {formOpen ? 'Đóng biểu mẫu' : 'Tạo yêu cầu hoàn tiền'}
        </Action>
      </Box>
      {!!success && (
        <Box>
          <Pill tone="green">Đã gửi thành công</Pill>
          <Text accessibilityRole="alert">{success}</Text>
        </Box>
      )}
      {formOpen && (
        <Box>
          <Heading
            title="Thông tin yêu cầu"
            detail="Số tiền tính bằng VND, không nhập số thập phân"
          />
          <MoneyTextInput
            mode="outlined"
            label="Số tiền yêu cầu hoàn (VND) *"
            accessibilityLabel="Số tiền yêu cầu hoàn (VND)"
            value={amount}
            disabled={busy}
            onChangeText={(value) => {
              setAmount(value);
              update();
            }}
          />
          <TextInput
            mode="outlined"
            label="Lý do yêu cầu *"
            accessibilityLabel="Lý do yêu cầu"
            value={reason}
            onChangeText={(value) => {
              setReason(value);
              update();
            }}
            maxLength={2000}
            multiline
            disabled={busy}
            style={ui.input}
          />
          <Text style={ui.muted}>
            Hai liên kết dưới đây đều không bắt buộc. Bạn có thể chọn cả hai hoặc để trống.
          </Text>
          <QueryState {...sources} />
          <ChoiceField
            label="Giao dịch liên quan (tùy chọn)"
            value={paymentId}
            options={[
              { id: '', label: 'Không liên kết giao dịch' },
              ...(sources.data?.payments ?? []),
            ]}
            searchable
            disabled={busy || sources.loading}
            onChange={(value) => {
              setPaymentId(value);
              update();
            }}
          />
          <ChoiceField
            label="Hợp đồng liên quan (tùy chọn)"
            value={contractId}
            options={[
              { id: '', label: 'Không liên kết hợp đồng' },
              ...(sources.data?.contracts ?? []),
            ]}
            searchable
            disabled={busy || sources.loading}
            onChange={(value) => {
              setContractId(value);
              update();
            }}
          />
          <Checkbox.Item
            label="Tôi xác nhận số tiền và lý do đề nghị Owner xem xét"
            status={confirmed ? 'checked' : 'unchecked'}
            disabled={busy}
            onPress={() => {
              setConfirmed(!confirmed);
              setError('');
            }}
          />
          {!!error && (
            <Text accessibilityRole="alert" style={ui.red}>
              {error}
            </Text>
          )}
          <Button
            mode="contained"
            icon="send-outline"
            loading={busy}
            disabled={busy}
            onPress={() => void submit()}
          >
            Gửi yêu cầu đến Owner
          </Button>
          <Text style={ui.muted}>
            Owner có thể chấp thuận và gửi chứng từ chuyển khoản, hoặc từ chối kèm lý do.
          </Text>
        </Box>
      )}
      <Box>
        <Row spread>
          <Heading title="Lịch sử yêu cầu" />
          <Button compact icon="refresh" disabled={requests.loading} onPress={refresh}>
            Tải lại
          </Button>
        </Row>
        <QueryState {...requests} />
        {requests.data?.items.length === 0 && (
          <Text style={ui.muted}>Bạn chưa gửi yêu cầu hoàn tiền nào.</Text>
        )}
        {requests.data?.items.map((item) => (
          <RefundRequestCard key={item.id} request={item} />
        ))}
        {requests.data && (
          <Pagination
            page={requests.data.page}
            total={requests.data.totalCount}
            loading={requests.loading}
            onChange={setPage}
          />
        )}
      </Box>
    </View>
  );
}

function RefundRequestCard({ request }: { request: TenantRefundRequest }) {
  const { api } = useSession();
  return (
    <View style={[ui.soft, { gap: 8 }]}>
      <Row spread>
        <Text variant="titleMedium" style={ui.money}>
          {formatContractMoney(request.amount)}
        </Text>
        <Pill
          tone={
            request.status === 'COMPLETED'
              ? 'green'
              : request.status === 'REJECTED'
                ? 'red'
                : 'amber'
          }
        >
          {statusLabels[request.status]}
        </Pill>
      </Row>
      <Text>{request.reason}</Text>
      <Text style={ui.muted}>Gửi lúc {formatInstant(request.createdAt)}</Text>
      {request.sourcePaymentId || request.sourceContractId ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {request.sourcePaymentId && <Pill tone="neutral">Có liên kết giao dịch</Pill>}
          {request.sourceContractId && <Pill tone="neutral">Có liên kết hợp đồng</Pill>}
        </View>
      ) : (
        <Text style={ui.muted}>Yêu cầu độc lập</Text>
      )}
      {request.decidedAt && (
        <Text style={ui.muted}>Owner phản hồi: {formatInstant(request.decidedAt)}</Text>
      )}
      {!!request.decisionReason && (
        <Text>
          {request.status === 'REJECTED' ? 'Lý do từ chối' : 'Phản hồi Owner'}:{' '}
          {request.decisionReason}
        </Text>
      )}
      {request.executedAt && <Text>Chuyển khoản: {formatInstant(request.executedAt)}</Text>}
      {!!request.externalReference && request.status === 'COMPLETED' && (
        <Text style={ui.muted}>Tham chiếu chuyển khoản: {request.externalReference}</Text>
      )}
      {request.status === 'COMPLETED' && request.hasEvidence && api && (
        <RefundReceiptEvidence id={request.id} />
      )}
    </View>
  );
}

function RefundReceiptEvidence({ id }: { id: string }) {
  const { api } = useSession();
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);

  async function load() {
    if (!api || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setError('');
    setBusy(true);
    try {
      const bytes = await api.request<Uint8Array>(
        `${tenantRefundRequestRoot}/${encodeURIComponent(id)}/evidence`,
        { signal: controller.signal },
        'bytes',
      );
      try {
        if (
          bytes.length > 5 * 1024 * 1024 ||
          bytes.length < 4 ||
          (!(bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) &&
            !(bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255))
        )
          throw new Error('Ảnh chứng từ không hợp lệ.');
        if (!controller.signal.aborted) setImage(ocrPreview(bytes));
      } finally {
        bytes.fill(0);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(errorMessage(cause));
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <View style={{ gap: 8 }}>
      <Action secondary disabled={busy} onPress={() => (image ? setImage('') : void load())}>
        {busy
          ? 'Đang tải chứng từ…'
          : image
            ? 'Ẩn chứng từ chuyển khoản'
            : 'Xem chứng từ chuyển khoản'}
      </Action>
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
      {!!image && (
        <Image
          source={{ uri: image }}
          style={{ width: '100%', height: 270 }}
          resizeMode="contain"
          accessibilityLabel="Chứng từ hoàn tiền Owner gửi"
        />
      )}
    </View>
  );
}
