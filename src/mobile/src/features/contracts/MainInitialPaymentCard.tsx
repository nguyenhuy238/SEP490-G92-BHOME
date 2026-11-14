import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image } from 'react-native';
import { Button, Text } from 'react-native-paper';
import {
  contractError,
  formatContractMoney,
  type ContractClient,
} from '../../../../../packages/client-core/src/contracts';
import {
  mainInitialPaymentClient,
  type MainInitialPayment,
} from '../../../../../packages/client-core/src/mainInitialPayment';
import { Box, Heading, ui } from '../../components/WorkspaceKit';

export function MainInitialPaymentCard({
  api,
  contractId,
  onPaid,
}: {
  api: ContractClient;
  contractId: string;
  onPaid: () => void;
}) {
  const service = useMemo(
    () => mainInitialPaymentClient(api.transport, contractId),
    [api, contractId],
  );
  const [data, setData] = useState<MainInitialPayment | null>(null);
  const [qr, setQr] = useState<MainInitialPayment | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      try {
        const result = await service.status(controller.signal);
        if (!controller.signal.aborted) {
          setData(result);
          setError('');
          if (result.paid) onPaid();
        }
      } catch (e) {
        if (!controller.signal.aborted) setError(contractError(e));
      } finally {
        loading = false;
      }
    }
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [service, onPaid]);
  async function generate() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await service.qr();
      setData(result);
      setQr(result);
      if (result.paid) onPaid();
    } catch (e) {
      setQr(null);
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Box>
      <Heading title="Thanh toán ban đầu" detail="Một QR cho toàn bộ số tiền còn phải trả." />
      {!data && !error && <Text>Đang kiểm tra số tiền từ backend…</Text>}
      {data && (
        <>
          {data.isDevelopmentDemo && (
            <Text style={ui.red}>SePay Test Mode · Không chuyển tiền thật.</Text>
          )}
          <Text>Cọc đảm bảo: {formatContractMoney(data.requiredDeposit)}</Text>
          <Text>Cọc Holding đã áp dụng: {formatContractMoney(data.holdingCredit)}</Text>
          {data.charges.map((line) => (
            <Text key={line.code}>
              {line.name}: {formatContractMoney(line.amount)}
            </Text>
          ))}
          <Text>Đã xác minh cọc: {formatContractMoney(data.verifiedDeposit)}</Text>
          <Text>Đã xác minh tiền thuê/phí: {formatContractMoney(data.verifiedRentAndFees)}</Text>
          <Text style={{ fontWeight: '700' }}>
            Còn phải trả: {formatContractMoney(data.outstandingAmount)}
          </Text>
          {data.paid ? (
            <Text style={ui.green}>Backend đã xác nhận thanh toán đủ.</Text>
          ) : (
            <>
              <Text style={ui.muted}>
                Giao dịch thiếu, thừa hoặc không khớp phải được đối soát; mở QR không đồng nghĩa đã
                trả tiền.
              </Text>
              {data.availability === 'ReceivingAccountUnavailable' && (
                <Text style={ui.red}>
                  Chưa có tài khoản nhận tiền phù hợp tại cơ sở. Owner cần kiểm tra cấu hình.
                </Text>
              )}
              <Button
                mode="contained"
                loading={busy}
                disabled={
                  busy ||
                  !data.signingComplete ||
                  data.availability === 'ReceivingAccountUnavailable'
                }
                onPress={() => void generate()}
              >
                Tạo QR thanh toán tổng
              </Button>
              {qr?.qrImageDataUri && qr.outstandingAmount === data.outstandingAmount && (
                <>
                  <Image
                    accessibilityLabel="QR thanh toán ban đầu"
                    source={{ uri: qr.qrImageDataUri }}
                    resizeMode="contain"
                    style={{ width: 240, height: 240, maxWidth: '100%', alignSelf: 'center' }}
                  />
                  <Text>Ngân hàng (BIN): {qr.bankIdentifier}</Text>
                  <Text>Tài khoản: {qr.accountNumber}</Text>
                  <Text>Chủ tài khoản: {qr.accountHolder}</Text>
                  <Text selectable>Nội dung: {qr.transferReference}</Text>
                </>
              )}
            </>
          )}
        </>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
    </Box>
  );
}
