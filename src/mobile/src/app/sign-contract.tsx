import React from 'react';
import { Redirect, useLocalSearchParams, type Href } from 'expo-router';
import { ActivityIndicator, Text } from 'react-native-paper';
import { Page } from '../components/Controls';
import { useSession } from '../lib/SessionProvider';
import { rememberPendingLink } from '../lib/pendingLink';
import { sessionRole } from '../features/workspace/navigation';

// Link from the "Bạn có hợp đồng cần ký" email: bhome://sign-contract?contractId=<id>.
// Signed in: open the contract's signing section. Not signed in: remember the target, sign in,
// and the home route continues to it (see app/index.tsx).
export default function SignContractLink() {
  const { contractId } = useLocalSearchParams<{ contractId?: string }>();
  const { session, ready } = useSession();
  const id = typeof contractId === 'string' && isContractId(contractId) ? contractId : '';
  if (!id)
    return (
      <Page>
        <Text>Liên kết ký hợp đồng không hợp lệ. Hãy mở hợp đồng trong ứng dụng BHOME.</Text>
      </Page>
    );
  if (!ready)
    return (
      <Page>
        <ActivityIndicator accessibilityLabel="Đang mở hợp đồng cần ký" />
      </Page>
    );
  const target = `/workspace/signing?contractId=${id}&section=signing` as Href;
  if (session && sessionRole(session.roles)) return <Redirect href={target} />;
  rememberPendingLink(target);
  return <Redirect href="/" />;
}

function isContractId(value: string) {
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value) &&
    !/^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(value)
  );
}
