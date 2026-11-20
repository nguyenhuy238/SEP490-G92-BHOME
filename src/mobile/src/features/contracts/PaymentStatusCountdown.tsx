import { useEffect, useState } from 'react';
import { Text } from 'react-native-paper';
import { ui } from '../../components/WorkspaceKit';

export const PAYMENT_STATUS_REFRESH_MS = 30000;

export function PaymentStatusCountdown({ checkedAt }: { checkedAt: number }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.min(
    PAYMENT_STATUS_REFRESH_MS / 1000,
    Math.max(0, Math.ceil((checkedAt + PAYMENT_STATUS_REFRESH_MS - now) / 1000)),
  );
  return (
    <Text style={ui.muted}>
      {seconds > 0
        ? `Đang chờ đối soát · Kiểm tra lại sau ${seconds}s`
        : 'Đang kiểm tra thanh toán…'}
    </Text>
  );
}
