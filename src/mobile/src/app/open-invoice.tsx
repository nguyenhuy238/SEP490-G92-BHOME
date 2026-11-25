import React from 'react';
import { Redirect, useLocalSearchParams, type Href } from 'expo-router';
import { ActivityIndicator, Text } from 'react-native-paper';
import { Page } from '../components/Controls';
import { useSession } from '../lib/SessionProvider';
import { rememberPendingLink } from '../lib/pendingLink';
import { sessionRole } from '../features/workspace/navigation';

// Email links carry only the invoice ID; the workspace and invoice API recheck access.
export default function OpenInvoiceLink() {
  const { invoiceId } = useLocalSearchParams<{ invoiceId?: string }>();
  const { session, ready } = useSession();
  const id =
    typeof invoiceId === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invoiceId) &&
    invoiceId !== '00000000-0000-0000-0000-000000000000'
      ? invoiceId
      : '';
  if (!id)
    return (
      <Page>
        <Text>Liên kết hóa đơn không hợp lệ. Hãy mở hóa đơn trong ứng dụng BHOME.</Text>
      </Page>
    );
  if (!ready)
    return (
      <Page>
        <ActivityIndicator accessibilityLabel="Đang mở hóa đơn" />
      </Page>
    );
  const target = `/workspace/invoice?invoiceId=${id}` as Href;
  if (session) {
    if (sessionRole(session.roles) === 'Tenant') return <Redirect href={target} />;
    return (
      <Page>
        <Text>Hãy đăng nhập bằng tài khoản khách thuê để xem hóa đơn.</Text>
      </Page>
    );
  }
  rememberPendingLink(target);
  return <Redirect href="/" />;
}
