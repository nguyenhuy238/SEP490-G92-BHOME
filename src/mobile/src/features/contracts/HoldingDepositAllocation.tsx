import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Checkbox, Text } from 'react-native-paper';
import {
  type ContractClient,
  type ContractView,
  formatContractMoney,
  mutationKeys,
} from '../../../../../packages/client-core/src/contracts';
import {
  type BankTransfer,
  type DepositAllocationContext,
  paymentClient,
  paymentError,
} from '../../../../../packages/client-core/src/payments';
import { Action, Box, Heading, Row, ui } from '../../components/WorkspaceKit';
import { ChoiceField } from '../../components/WorkflowControls';
import { randomUUID } from '../../lib/randomUUID';

export function HoldingDepositAllocation({
  api,
  role,
  contract,
  onChanged,
}: {
  api: ContractClient;
  role: string;
  contract: ContractView;
  onChanged: () => void;
}) {
  const client = useMemo(() => paymentClient(api.transport), [api]);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [listState, setListState] = useState<{
    client: ReturnType<typeof paymentClient>;
    page: number;
    revision: number;
    items: BankTransfer[];
    hasMore: boolean;
    error?: string;
  } | null>(null);
  const [transfer, setTransfer] = useState('');
  const [contextState, setContextState] = useState<{
    client: ReturnType<typeof paymentClient>;
    transfer: string;
    contractId: string;
    revision: number;
    data: DepositAllocationContext | null;
    error?: string;
  } | null>(null);
  const [payer, setPayer] = useState('');
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const [keys] = useState(() => mutationKeys(randomUUID));
  const lock = useRef(false);
  useEffect(() => {
    if (role !== 'Owner' || !open) return;
    const controller = new AbortController();
    void client
      .transfers({ page }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setListState({
            client,
            page,
            revision,
            items: result.items,
            hasMore: page * result.pageSize < result.totalCount,
          });
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setListState({
            client,
            page,
            revision,
            items: [],
            hasMore: false,
            error: paymentError(e),
          });
      });
    return () => controller.abort();
  }, [client, role, open, page, revision]);
  useEffect(() => {
    if (role !== 'Owner' || !transfer || !open) return;
    const controller = new AbortController();
    void client
      .depositContext(transfer, contract.id, controller.signal)
      .then((result) => {
        if (
          !controller.signal.aborted &&
          result.transferId === transfer &&
          result.contractId === contract.id
        )
          setContextState({ client, transfer, contractId: contract.id, revision, data: result });
        else if (!controller.signal.aborted)
          setContextState({
            client,
            transfer,
            contractId: contract.id,
            revision,
            data: null,
            error: 'Không xác minh được thông tin giao dịch. Vui lòng tải lại.',
          });
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setContextState({
            client,
            transfer,
            contractId: contract.id,
            revision,
            data: null,
            error: paymentError(e),
          });
      });
    return () => controller.abort();
  }, [client, role, transfer, contract.id, open, revision]);
  const list =
    listState?.client === client && listState.page === page && listState.revision === revision
      ? listState
      : null;
  const currentContext =
    contextState?.client === client &&
    contextState.transfer === transfer &&
    contextState.contractId === contract.id &&
    contextState.revision === revision
      ? contextState
      : null;
  const transfers = list?.items ?? [];
  const hasMore = list?.hasMore ?? false;
  const context = currentContext?.data ?? null;
  const loading = open && (!list || (!!transfer && !currentContext));
  const message = error || list?.error || currentContext?.error;
  const selected = context?.payers.find((item) => item.residentId === payer);
  const external = payer === 'external' ? context?.externalPayer : null;
  async function allocate() {
    if (
      role !== 'Owner' ||
      lock.current ||
      !checked ||
      !context ||
      context.problems.length ||
      (!selected && !external)
    )
      return;
    const body = {
      contractId: contract.id,
      paidByUserId: selected?.userId ?? null,
      ...(selected
        ? { paidByResidentId: selected.residentId }
        : { externalPayerAttestationId: external!.id }),
      expectedReference: context.reference,
      humanVerified: true,
    };
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = await api.transport<{ status: string; reason: string }>(
        `/api/v1/payment-transactions/${encodeURIComponent(transfer)}/allocate-holding-deposit`,
        {
          method: 'POST',
          headers: { 'Idempotency-Key': keys.get('holding-allocation:' + transfer, body) },
          body: JSON.stringify(body),
        },
      );
      if (result.status === 'Allocated') {
        keys.confirmed('holding-allocation:' + transfer, body);
        setNotice('Máy chủ đã xác nhận phân bổ cọc.');
        setTransfer('');
      } else setError('Giao dịch chưa được phân bổ. Vui lòng đối chiếu lại trên hệ thống.');
      setChecked(false);
      setRevision((value) => value + 1);
      onChanged();
    } catch (e) {
      setError(paymentError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  if (role !== 'Owner') return null;
  return (
    <Box>
      <Action secondary disabled={busy} onPress={() => setOpen((value) => !value)}>
        {open ? 'Thu gọn phân bổ giao dịch' : 'Phân bổ giao dịch ngân hàng'}
      </Action>
      {open && (
        <>
          <Heading title="Phân bổ tiền cọc giữ chỗ" />
          <ChoiceField
            label="Giao dịch ngân hàng"
            value={transfer}
            options={transfers.map((item) => ({
              id: item.id,
              label: `${item.bankReference} · ${formatContractMoney(item.amount)}`,
            }))}
            disabled={loading || busy}
            onChange={(value) => {
              setTransfer(value);
              setPayer('');
              setError('');
              setChecked(false);
            }}
          />
          {!loading && !transfers.length && (
            <Text>Chưa có giao dịch ngân hàng trên trang này.</Text>
          )}
          <Row>
            <Action
              secondary
              disabled={loading || busy || page <= 1}
              onPress={() => {
                setTransfer('');
                setPage((value) => value - 1);
              }}
            >
              Trang trước
            </Action>
            <Action
              secondary
              disabled={loading || busy || !hasMore}
              onPress={() => {
                setTransfer('');
                setPage((value) => value + 1);
              }}
            >
              Trang sau
            </Action>
          </Row>
          {context && (
            <>
              <Text>
                Cọc còn thiếu: {formatContractMoney(context.remaining)} · Dự kiến phân bổ:{' '}
                {formatContractMoney(context.proposedAllocation)}
              </Text>
              {!!context.problems.length && (
                <Text>Giao dịch chưa đủ điều kiện phân bổ. Cần đối chiếu lại trên hệ thống.</Text>
              )}
              <ChoiceField
                label="Người thực chuyển tiền"
                value={payer}
                options={[
                  ...context.payers.map((item) => ({ id: item.residentId, label: item.label })),
                  ...(context.externalPayer
                    ? [{ id: 'external', label: context.externalPayer.payerLabel }]
                    : []),
                ]}
                disabled={loading || busy || !!context.problems.length}
                onChange={(value) => {
                  setPayer(value);
                  setChecked(false);
                }}
              />
              <Checkbox.Item
                label="Đã đối chiếu giao dịch và người thực chuyển tiền"
                status={checked ? 'checked' : 'unchecked'}
                disabled={busy || loading || !!context.problems.length}
                onPress={() => setChecked((value) => !value)}
              />
              <Action
                disabled={
                  busy ||
                  loading ||
                  !checked ||
                  !!context.problems.length ||
                  (!selected && !external)
                }
                onPress={() => void allocate()}
              >
                {busy ? 'Đang xác nhận…' : 'Xác nhận phân bổ cọc'}
              </Action>
            </>
          )}
          <Action
            secondary
            disabled={busy || loading}
            onPress={() => {
              setChecked(false);
              setError('');
              setRevision((value) => value + 1);
            }}
          >
            Tải lại giao dịch
          </Action>
          {loading && <Text>Đang đối chiếu giao dịch…</Text>}
        </>
      )}
      {!!message && <Text style={ui.red}>{message}</Text>}
      {!!notice && <Text>{notice}</Text>}
    </Box>
  );
}
