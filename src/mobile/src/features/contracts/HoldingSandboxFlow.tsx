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
import { Heading, ui } from '../../components/WorkspaceKit';
import { HoldingProgress } from './HoldingProgress';
import { HoldingSigningConfirmation } from './HoldingSigningConfirmation';
import {
  HoldingChecklistRow,
  HoldingInfoRow,
  HoldingSectionCard,
  HoldingStatusBadge,
} from './HoldingUi';

export function useHoldingSandbox(api: ContractClient, c: ContractView, allowed = true) {
  const enabled = allowed && typeof __DEV__ !== 'undefined' && __DEV__ && c.isDevelopmentDemo;
  const [data, setData] = useState<HoldingSandboxState | null>(null);
  const [latestContract, setLatestContract] = useState<ContractView | null>(null);
  const service = useMemo(() => holdingSandboxClient(api.transport, c.id), [api, c.id]);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const load = () =>
      service
        .status(controller.signal)
        .then(async (result) => {
          const latest = await api.get(c.id, controller.signal);
          if (!controller.signal.aborted && latest?.id === c.id && latest.kind === 'Holding')
            setLatestContract((previous) =>
              JSON.stringify(previous) === JSON.stringify(latest) ? previous : latest,
            );
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
    const timer = setInterval(() => void load(), 10000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [enabled, service, api, c.id, c.status, c.approvedAt]);
  return {
    data: enabled ? data : null,
    setData,
    service,
    latestContract: latestContract?.id === c.id ? latestContract : null,
    setLatestContract,
  };
}

export function HoldingSandboxFlow({
  api,
  contract,
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
  const c = sandbox.latestContract ?? contract;
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
  async function run(action: 'Tenant' | 'refresh' | 'activate' | 'skip-preview') {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const latest =
        action === 'skip-preview'
          ? await sandbox.service.skipSigningPreview()
          : action === 'refresh'
            ? await sandbox.service.status()
            : action === 'activate'
              ? await sandbox.service.activate()
              : await sandbox.service.simulate(action);
      sandbox.setData(latest);
      if (action === 'skip-preview' && latest.canShowQr) setShowQr(true);
      if (action === 'refresh') {
        const fresh = await api.get(c.id);
        if (fresh?.id === c.id && fresh.kind === 'Holding') sandbox.setLatestContract(fresh);
        onChanged();
      }
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
      <HoldingProgress current={state.onHold ? 7 : showQr ? 6 : c.approvedAt ? 5 : 4} />
      <HoldingSectionCard title="Thông tin giữ chỗ">
        <Heading title={`Phòng ${c.roomNumber || '—'}`} detail={c.locationName} />
        <HoldingStatusBadge label="SePay Test Mode · Chỉ dùng kiểm thử" tone="warning" />
        <HoldingInfoRow
          label="Người giữ chỗ"
          value={c.occupants?.find((r) => r.representative)?.label}
        />
        <HoldingInfoRow
          label="Thời hạn giữ chỗ"
          value={`${displayContractDate(c.startDate)} – ${displayContractDate(c.endDate)}`}
        />
        <HoldingInfoRow label="Tiền giữ chỗ" value={formatContractMoney(state.required)} />
      </HoldingSectionCard>
      {!c.approvedAt && !state.onHold && (
        <HoldingSectionCard title="Chờ Owner phê duyệt">
          <HoldingStatusBadge label="Bản nháp đang chờ phê duyệt" tone="warning" />
          <Text style={ui.muted}>
            Owner cần xem và phê duyệt hợp đồng trên Web trước khi gửi lời mời ký.
          </Text>
          <Button
            mode="contained"
            contentStyle={{ minHeight: 44 }}
            disabled={busy}
            onPress={() => void run('skip-preview').catch(() => {})}
          >
            Bỏ qua ký: xem QR kiểm thử
          </Button>
          <Text style={ui.muted}>
            Chỉ Sandbox: xem thử QR, không ghi nhận chữ ký, phê duyệt hay kích hoạt thật.
          </Text>
          <Button
            mode="outlined"
            contentStyle={{ minHeight: 44 }}
            loading={busy === true}
            disabled={busy}
            onPress={() => void run('refresh').catch(() => {})}
          >
            Tải lại trạng thái
          </Button>
          <Text style={ui.muted}>Trạng thái cũng tự cập nhật mỗi 10 giây.</Text>
          <Button mode="outlined" disabled>
            Mô phỏng người giữ chỗ đã ký
          </Button>
          <Text style={ui.muted}>
            Nút mô phỏng Tenant sẽ bật sau khi Owner phê duyệt. Kết quả được lưu qua API Sandbox.
          </Text>
        </HoldingSectionCard>
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
        <HoldingSectionCard>
          <Heading
            title="QR chuyển khoản · Test Mode"
            detail="Mã QR thử nghiệm của SePay. Không chuyển tiền thật."
          />
          <HoldingStatusBadge label="Chỉ dùng kiểm thử" tone="warning" />
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
              {!qr.qrImageDataUri && (
                <Text style={ui.muted}>
                  Dịch vụ kiểm thử chưa cung cấp hình QR. Dùng thông tin chuyển khoản bên dưới để
                  đối chiếu.
                </Text>
              )}
              <HoldingInfoRow label="Ngân hàng (BIN)" value={qr.bankIdentifier} />
              <HoldingInfoRow label="Số tài khoản" value={qr.accountNumber} />
              <HoldingInfoRow label="Chủ tài khoản" value={qr.accountHolder} />
              <HoldingInfoRow label="Còn thiếu" value={formatContractMoney(qr.outstandingAmount)} />
              <Text selectable>Nội dung chuyển khoản: {qr.transferReference}</Text>
            </>
          )}
        </HoldingSectionCard>
      )}
      {showQr && !state.onHold && (
        <HoldingSectionCard title="Trạng thái thanh toán">
          <HoldingInfoRow label="Đã xác minh" value={formatContractMoney(state.verified)} />
          <HoldingStatusBadge
            label={state.depositVerified ? 'Đã xác minh đủ tiền cọc' : 'Chờ xác minh giao dịch'}
            tone={state.depositVerified ? 'success' : 'warning'}
          />
          <Text style={state.depositVerified ? ui.green : ui.muted}>
            {state.depositVerified
              ? 'Backend đã xác minh đủ tiền cọc.'
              : 'Chờ SePay xác minh giao dịch. Bấm kiểm tra không ghi nhận tiền.'}
          </Text>
          <Button
            mode="outlined"
            contentStyle={{ minHeight: 44 }}
            disabled={busy}
            onPress={() => void run('refresh').catch(() => {})}
          >
            Kiểm tra thanh toán
          </Button>
          <Button
            mode="contained"
            contentStyle={{ minHeight: 44 }}
            disabled={busy || !state.depositVerified}
            onPress={() => void run('activate').catch(() => {})}
          >
            Hoàn tất giữ chỗ (Test Mode)
          </Button>
        </HoldingSectionCard>
      )}
      {state.onHold && (
        <HoldingSectionCard>
          <Heading title="Giữ chỗ thành công · Test Mode" />
          <HoldingStatusBadge label="Đã hoàn tất giữ chỗ kiểm thử" tone="success" />
          <Text style={ui.green}>Backend sandbox: hợp đồng Active, phòng OnHold.</Text>
          <HoldingChecklistRow
            label="Hợp đồng Active (Sandbox)"
            complete={state.contractStatus === 'Active'}
          />
          <HoldingChecklistRow label="Phòng OnHold (Sandbox)" complete={state.onHold} />
          <HoldingChecklistRow label="Đủ tiền cọc đã xác minh" complete={state.depositVerified} />
          <Text style={ui.muted}>Chỉ là dữ liệu thử nghiệm, không có chữ ký pháp lý.</Text>
          <Button mode="contained" contentStyle={{ minHeight: 44 }} onPress={onList}>
            Hoàn tất
          </Button>
        </HoldingSectionCard>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
    </>
  );
}
