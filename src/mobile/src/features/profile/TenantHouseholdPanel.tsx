import React, { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Button, Text } from 'react-native-paper';
import {
  householdClient,
  type HouseholdView,
} from '../../../../../packages/client-core/src/households';
import { displayContractDate } from '../../../../../packages/client-core/src/contracts';
import { useTenantTenancy } from '../tenant/useTenantTenancy';
import { useSession } from '../../lib/SessionProvider';
import { profileStyles as styles } from './ProfileComponents';

export function TenantHouseholdPanel() {
  const { api } = useSession();
  const tenancy = useTenantTenancy(false);
  const id = tenancy.current?.id;
  const client = useMemo(
    () => (api ? householdClient((path, init, type) => api.request(path, init, type)) : null),
    [api],
  );
  const [result, setResult] = useState<{ id: string; data?: HouseholdView; error?: string }>();
  const [selected, setSelected] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!id || !client) return;
    const controller = new AbortController();
    client
      .contract(id, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ id, data });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setResult({ id, error: 'Chưa tải được thông tin hộ gia đình. Vui lòng thử lại.' });
      });
    return () => controller.abort();
  }, [id, client, revision]);
  if (!id) return null;
  const data = result?.id === id ? result.data : undefined;
  const error = result?.id === id ? result.error : undefined;
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Hộ gia đình của tôi</Text>
      {tenancy.items.length > 1 &&
        tenancy.items.map((contract) => (
          <Button
            key={contract.id}
            mode={id === contract.id ? 'contained' : 'outlined'}
            onPress={() => tenancy.select(contract.id)}
          >
            Phòng {contract.roomNumber}
          </Button>
        ))}
      {!data && !error && <Text style={styles.label}>Đang tải thông tin người ở…</Text>}
      {error && (
        <>
          <Text accessibilityRole="alert">{error}</Text>
          <Button onPress={() => setRevision((v) => v + 1)}>Thử lại</Button>
        </>
      )}
      {data?.representative && (
        <View style={styles.field}>
          <Text style={styles.value}>{data.representative.fullName} · Người đại diện</Text>
          <Text style={styles.label}>
            Ngày sinh: {displayContractDate(data.representative.dateOfBirth)}
          </Text>
          {!!data.representative.phone && (
            <Text style={styles.label}>Điện thoại: {data.representative.phone}</Text>
          )}
          {!!data.representative.maskedCitizenNumber && (
            <Text style={styles.label}>CCCD: {data.representative.maskedCitizenNumber}</Text>
          )}
        </View>
      )}
      {data && (
        <Text style={styles.label}>
          {data.members.length} thành viên cùng ở · Không tính người đại diện
        </Text>
      )}
      {data?.members.map((member) => (
        <View key={member.residentId} style={styles.field}>
          <Button
            mode="text"
            onPress={() =>
              setSelected((value) => (value === member.residentId ? '' : member.residentId))
            }
            accessibilityState={{ expanded: selected === member.residentId }}
          >
            {member.fullName} · {member.relationship}
          </Button>
          {selected === member.residentId && (
            <>
              <Text style={styles.value}>Ngày sinh: {displayContractDate(member.dateOfBirth)}</Text>
              <Text style={styles.value}>Điện thoại: {member.phone || 'Chưa cung cấp'}</Text>
              <Text style={styles.value}>
                CCCD:{' '}
                {member.citizenNumber
                  ? `********${member.citizenNumber.slice(-4)}`
                  : 'Chưa cung cấp'}
              </Text>
            </>
          )}
        </View>
      ))}
    </View>
  );
}
