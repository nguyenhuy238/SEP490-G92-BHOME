import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { Action, Box, Heading, Metric, ui } from '../components/WorkspaceKit';
import { useSession } from '../lib/SessionProvider';
import { errorMessage } from '../lib/api';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { loadOwnerOverview, type OwnerOverview } from '../services/ownerOverview';

export function OwnerOverviewScreen() {
  const { api, baseUrl, session } = useSession();
  const { go } = useWorkspace();
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    data: OwnerOverview | null;
    error: string;
    loading: boolean;
  }>({ data: null, error: '', loading: true });
  useEffect(() => {
    if (!api || !session?.roles.includes('Owner')) return;
    const controller = new AbortController();
    void loadOwnerOverview(api, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ data, error: '', loading: false });
      },
      (error) => {
        if (!controller.signal.aborted)
          setState({ data: null, error: errorMessage(error), loading: false });
      },
    );
    return () => controller.abort();
  }, [api, session, revision]);
  if (!api || !session?.roles.includes('Owner'))
    return <Text>Cần đăng nhập Owner để xem tổng quan.</Text>;
  return (
    <>
      <Heading title="Tổng quan BHOME" detail="Cơ sở, phòng và hợp đồng trong phạm vi tài khoản" />
      <Text variant="bodySmall">API: {baseUrl}</Text>
      <Action
        secondary
        disabled={state.loading}
        onPress={() => {
          setState({ data: null, error: '', loading: true });
          setRevision((value) => value + 1);
        }}
      >
        Tải lại dữ liệu
      </Action>
      {state.loading && <ActivityIndicator accessibilityLabel="Đang tải tổng quan" />}
      {!!state.error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {state.error}
        </Text>
      )}
      {state.data && (
        <View style={ui.wrap}>
          <Metric
            label="Cơ sở"
            value={String(state.data.locations)}
            icon="office-building-outline"
            detail="Tổng số cơ sở"
          />
          <Metric
            label="Phòng"
            value={String(state.data.rooms)}
            icon="door-open"
            detail="Tổng số phòng"
          />
          <Metric
            label="Phòng đang ở"
            value={String(state.data.occupiedRooms)}
            icon="home-account"
            detail="Trạng thái Occupied từ máy chủ"
          />
          <Metric
            label="Hợp đồng"
            value={String(state.data.contracts)}
            icon="file-document-outline"
            detail="Tất cả trạng thái"
          />
        </View>
      )}
      <Action icon="file-document-outline" onPress={() => go('signing')}>
        Hợp đồng & Vòng đời
      </Action>
      <Box>
        <Text>Báo cáo doanh thu, công nợ và chi phí chưa được triển khai trên màn hình này.</Text>
      </Box>
      <Action secondary onPress={() => go('profile')}>
        Tài khoản & Đăng xuất
      </Action>
    </>
  );
}
