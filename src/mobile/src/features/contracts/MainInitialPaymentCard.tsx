import { ContractNotice } from './ContractNotice';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
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
import { ui } from '../../components/WorkspaceKit';
import { ContractLoading } from './ContractLoading';
import { HoldingInfoRow, HoldingSectionCard, HoldingStatusBadge } from './HoldingUi';
import { PaymentStatusCountdown, PAYMENT_STATUS_REFRESH_MS } from './PaymentStatusCountdown';

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
  const [checkedAt, setCheckedAt] = useState(Date.now);
  const [showDetails, setShowDetails] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    let loading = false;
    async function load() {
      if (loading) return;
      loading = true;
      setCheckedAt(Date.now());
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
    const timer = setInterval(() => void load(), PAYMENT_STATUS_REFRESH_MS);
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
  const currentQr =
    qr?.transferReference &&
    data &&
    data.transferReference === qr.transferReference &&
    qr.outstandingAmount === data.outstandingAmount
      ? qr
      : null;
  const meteredRates = data?.meteredRates ?? [];
  if (!data && !error) return <ContractLoading compact label="Đang tải thông tin thanh toán…" />;
  return (
    <>
      <HoldingSectionCard title="Thanh toán ban đầu">
        {data && (
          <>
            <HoldingStatusBadge
              label={data.paid ? 'Đã thanh toán đủ' : 'Chờ thanh toán'}
              tone={data.paid ? 'success' : 'warning'}
            />
            {!data.paid &&
              data.availability !== 'PaymentProviderDisabled' &&
              data.transferReference && <PaymentStatusCountdown checkedAt={checkedAt} />}
            <View style={styles.amountBlock}>
              <Text style={styles.note}>Còn phải trả</Text>
              <Text selectable style={styles.amount}>
                {formatContractMoney(data.outstandingAmount)}
              </Text>
            </View>
            {Number(data.holdingCredit) > 0 && (
              <HoldingInfoRow
                label="Tiền giữ chỗ đã áp dụng"
                value={formatContractMoney(data.holdingCredit)}
              />
            )}
            <Button
              mode="text"
              icon={showDetails ? 'chevron-up' : 'chevron-down'}
              accessibilityState={{ expanded: showDetails }}
              contentStyle={styles.buttonContent}
              style={styles.detailsButton}
              onPress={() => setShowDetails((shown) => !shown)}
            >
              {showDetails ? 'Thu gọn chi tiết' : 'Xem chi tiết khoản thu'}
            </Button>
            {showDetails && (
              <View style={styles.details}>
                <HoldingInfoRow
                  label="Cọc đảm bảo theo hợp đồng"
                  value={formatContractMoney(data.requiredDeposit)}
                />
                {data.charges.map((line) => (
                  <HoldingInfoRow
                    key={line.code}
                    label={line.name}
                    value={formatContractMoney(line.amount)}
                  />
                ))}
                <HoldingInfoRow
                  label="Cọc đã ghi nhận (gồm tiền giữ chỗ đã cấn)"
                  value={formatContractMoney(data.verifiedDeposit)}
                />
                {data.outstandingDeposit !== undefined && (
                  <HoldingInfoRow
                    label="Cọc còn phải nộp"
                    value={formatContractMoney(data.outstandingDeposit)}
                  />
                )}
                <HoldingInfoRow
                  label="Tiền thuê và phí đã thanh toán"
                  value={formatContractMoney(data.verifiedRentAndFees)}
                />
                {data.outstandingRentAndFees !== undefined && (
                  <HoldingInfoRow
                    label="Tiền thuê và phí còn phải nộp"
                    value={formatContractMoney(data.outstandingRentAndFees)}
                  />
                )}
                {meteredRates.length > 0 && (
                  <View style={styles.details}>
                    <Text variant="titleSmall">Tính trên hóa đơn theo chỉ số</Text>
                    {meteredRates.map((line) => (
                      <HoldingInfoRow
                        key={line.code}
                        label={line.name}
                        value={`${formatContractMoney(line.rate)}/${line.unit}`}
                      />
                    ))}
                    <Text style={styles.note}>Tính theo mức sử dụng đã xác nhận.</Text>
                  </View>
                )}
              </View>
            )}
            {data.paid ? (
              <Text style={ui.green}>
                Thanh toán đã được xác nhận. Tiếp tục bước kích hoạt hợp đồng.
              </Text>
            ) : null}
          </>
        )}
        {!!error && <ContractNotice message={error} />}
      </HoldingSectionCard>
      {data && !data.paid && (
        <HoldingSectionCard title="Thông tin chuyển khoản">
          <HoldingStatusBadge
            label={data.isDevelopmentDemo ? 'SePay Test' : 'Chuyển khoản ngân hàng'}
            tone={data.isDevelopmentDemo ? 'warning' : 'neutral'}
          />
          {data.isDevelopmentDemo && <Text style={styles.note}>Không chuyển tiền thật.</Text>}
          {currentQr && (
            <>
              {currentQr.qrImageDataUri ? (
                <View style={styles.qrFrame}>
                  <Image
                    accessibilityLabel="QR thanh toán ban đầu"
                    source={{ uri: currentQr.qrImageDataUri }}
                    resizeMode="contain"
                    style={styles.qrImage}
                  />
                </View>
              ) : (
                <Text style={styles.note}>
                  Chưa có ảnh QR. Dùng thông tin chuyển khoản bên dưới hoặc tải lại.
                </Text>
              )}
              <HoldingInfoRow label="Ngân hàng (BIN)" value={currentQr.bankIdentifier} />
              <HoldingInfoRow
                label={data.isDevelopmentDemo ? 'Số tài khoản Test' : 'Số tài khoản'}
                value={currentQr.accountNumber}
              />
              <HoldingInfoRow label="Chủ tài khoản" value={currentQr.accountHolder} />
              <HoldingInfoRow
                label="Số tiền chuyển khoản"
                value={formatContractMoney(currentQr.outstandingAmount)}
              />
              <View style={styles.transferReference}>
                <Text style={styles.note}>Nội dung chuyển khoản</Text>
                <Text selectable style={styles.referenceValue}>
                  {currentQr.transferReference}
                </Text>
              </View>
              <Text style={styles.note}>
                Chuyển đúng số tiền và nội dung để hệ thống tự đối soát.
              </Text>
            </>
          )}
          {!data.signingComplete && (
            <Text style={styles.note}>Cần đủ chữ ký hai bên trước khi tạo QR thanh toán.</Text>
          )}
          {data.availability === 'ReceivingAccountUnavailable' && (
            <ContractNotice message="Tài khoản nhận tiền chưa sẵn sàng. Owner cần kiểm tra tài khoản và kết nối SePay." />
          )}
          {data.availability === 'PaymentProviderDisabled' && (
            <ContractNotice message="SePay đang tắt trong môi trường này. Hệ thống chưa thể cấp mã thanh toán hoặc QR." />
          )}
          {qr?.availability === 'PaymentCodeUnavailable' &&
            data.availability === 'PaymentCodeUnavailable' && (
              <ContractNotice message="Chưa cấp được mã đối soát. Hãy thử tạo QR lại trước khi chuyển khoản." />
            )}
          <Button
            mode={currentQr ? 'outlined' : 'contained'}
            loading={busy}
            contentStyle={styles.buttonContent}
            style={styles.button}
            disabled={
              busy ||
              !data.signingComplete ||
              data.availability === 'ReceivingAccountUnavailable' ||
              data.availability === 'PaymentProviderDisabled'
            }
            onPress={() => void generate()}
          >
            {currentQr ? 'Tải lại QR chuyển khoản' : 'Tạo QR thanh toán tổng'}
          </Button>
        </HoldingSectionCard>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  amountBlock: { gap: 4, paddingVertical: 6 },
  amount: { fontSize: 28, lineHeight: 36, fontWeight: '700', color: '#193653' },
  note: { fontSize: 12, lineHeight: 18, color: '#526581' },
  details: { gap: 8, borderTopWidth: 1, borderColor: '#E2E8F0', paddingTop: 12 },
  detailsButton: { alignSelf: 'flex-start', marginLeft: -8 },
  button: { borderRadius: 10 },
  buttonContent: { minHeight: 44 },
  qrFrame: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    backgroundColor: '#F5F7FB',
    borderRadius: 12,
  },
  qrImage: { width: 240, height: 240, maxWidth: '100%' },
  transferReference: { backgroundColor: '#F2F6FB', borderRadius: 10, padding: 12, gap: 4 },
  referenceValue: { fontSize: 14, lineHeight: 21, fontWeight: '700', color: '#193653' },
});
