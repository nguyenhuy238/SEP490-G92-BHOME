import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'react-native';
import { Button, Text } from 'react-native-paper';
import {
  holdingSandboxClient,
  type HoldingSandboxState,
  type HoldingSandboxQr,
} from '../../../../../packages/client-core/src/holdingSandbox';
import {
  contractError,
  displayContractDate,
  formatContractMoney,
  type ContractClient,
  type ContractView,
} from '../../../../../packages/client-core/src/contracts';
import { Box, Heading, ui } from '../../components/WorkspaceKit';
import { HoldingProgress } from './HoldingProgress';
import { HoldingSigningConfirmation } from './HoldingSigningConfirmation';

export function useHoldingSandbox(api: ContractClient, c: ContractView) {
  const enabled = typeof __DEV__ !== 'undefined' && __DEV__ && c.isDevelopmentDemo;
  const [data, setData] = useState<HoldingSandboxState | null>(null);
  const service = useMemo(() => holdingSandboxClient(api.transport, c.id), [api, c.id]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const load = () =>
      service
        .status(controller.signal)
        .then((result) => {
          if (!controller.signal.aborted)
            setData((previous) =>
              result.mode !== 'Test'
                ? null
                : JSON.stringify(previous) === JSON.stringify(result)
                  ? previous
                  : result,
            );
        })
        .catch(() => {
          if (!controller.signal.aborted) setData(null);
        });
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [enabled, service, c.status, c.approvedAt]);
  return { data: enabled ? data : null, setData, service };
}

export function HoldingSandboxFlow({
  api,
  contract: c,
  sandbox,
  onChanged,
  onList,
}: {
  api: ContractClient;
  contract: ContractView;
  sandbox: ReturnType<typeof useHoldingSandbox>;
  onChanged: () => void;
  onList: () => void;
}) {
  const state = sandbox.data!;
  const [requestedQr, setShowQr] = useState(state.canShowQr);
  const showQr = requestedQr && state.canShowQr;
  const [qr, setQr] = useState<HoldingSandboxQr | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    if (!showQr || !state.canShowQr || state.onHold) return;
    const controller = new AbortController();
    void sandbox.service
      .qr(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setQr(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(contractError(e));
      });
    return () => controller.abort();
  }, [sandbox.service, showQr, state.canShowQr, state.onHold]);
  async function run(action: 'Tenant' | 'refresh' | 'activate') {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const latest =
        action === 'refresh'
          ? await sandbox.service.status()
          : action === 'activate'
            ? await sandbox.service.activate()
            : await sandbox.service.simulate(action);
      sandbox.setData(latest);
      if (action === 'activate') onChanged();
    } catch (e) {
      setError(contractError(e));
      throw e;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Box>
        <Heading title={`Phòng ${c.roomNumber || '—'}`} detail={c.locationName} />
        <Text>SePay Test Mode · Owner xác nhận trên Web, Tenant có chế độ kiểm thử.</Text>
        <Text>
          {displayContractDate(c.startDate)} – {displayContractDate(c.endDate)}
        </Text>
        <Text>Tiền giữ chỗ: {formatContractMoney(state.required)}</Text>
      </Box>
      <HoldingProgress current={state.onHold ? 7 : showQr ? 6 : c.approvedAt ? 5 : 4} />
      {!c.approvedAt && !state.onHold && (
        <Box>
          <Heading title="Chờ Owner phê duyệt" />
          <Text>Owner cần kiểm tra và phê duyệt hợp đồng trên Web trước khi gửi lời mời ký.</Text>
        </Box>
      )}
      {!!c.approvedAt && !showQr && !state.onHold && (
        <HoldingSigningConfirmation
          key={`${c.id}:${c.snapshotHash}`}
          api={api}
          contract={c}
          simulation={{
            tenantSimulated: state.tenantSimulated,
            canShowQr: state.canShowQr,
            simulate: async () => {
              await run('Tenant');
            },
          }}
          onContinue={() => setShowQr(true)}
          onChanged={onChanged}
        />
      )}
      {showQr && !state.onHold && (
        <Box>
          <Heading
            title="QR chuyển khoản · Test Mode"
            detail="Chỉ kiểm thử trên SePay Test Mode, không chuyển tiền thật."
          />
          {!qr && !error && <Text>Đang tạo mã QR…</Text>}
          {qr && (
            <>
              {qr.qrImageDataUri && (
                <Image
                  accessibilityLabel="QR tiền giữ chỗ Test Mode"
                  source={{ uri: qr.qrImageDataUri }}
                  resizeMode="contain"
                  style={{ width: 240, height: 240, maxWidth: '100%', alignSelf: 'center' }}
                />
              )}
              <Text>Ngân hàng (BIN): {qr.bankIdentifier}</Text>
              <Text>Tài khoản: {qr.accountNumber}</Text>
              <Text>Chủ tài khoản: {qr.accountHolder}</Text>
              <Text>Còn thiếu: {formatContractMoney(qr.outstandingAmount)}</Text>
              <Text selectable>Nội dung: {qr.transferReference}</Text>
            </>
          )}
          <Text>Đã xác minh: {formatContractMoney(state.verified)}</Text>
          <Text style={state.depositVerified ? ui.green : ui.muted}>
            {state.depositVerified
              ? 'Backend đã xác minh đủ tiền cọc.'
              : 'Chờ SePay xác minh giao dịch. Bấm kiểm tra không ghi nhận tiền.'}
          </Text>
          <Button disabled={busy} onPress={() => void run('refresh').catch(() => {})}>
            Kiểm tra thanh toán
          </Button>
          <Button
            mode="contained"
            disabled={busy || !state.depositVerified}
            onPress={() => void run('activate').catch(() => {})}
          >
            Hoàn tất giữ chỗ (Test Mode)
          </Button>
        </Box>
      )}
      {state.onHold && (
        <Box>
          <Heading title="Giữ chỗ thành công · Test Mode" />
          <Text style={ui.green}>Backend sandbox: hợp đồng Active, phòng OnHold.</Text>
          <Text>Chỉ là dữ liệu thử nghiệm, không có chữ ký pháp lý.</Text>
          <Button mode="contained" onPress={onList}>
            Hoàn tất
          </Button>
        </Box>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
    </>
  );
}
