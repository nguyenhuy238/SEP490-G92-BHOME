import { IncidentInbox } from '../features/incidents/IncidentScreens';
import { useFeedbackState } from '../lib/useFeedbackState';
import React, { useEffect, useRef, useState } from 'react';
import { router } from 'expo-router';
import { Text } from 'react-native-paper';
import {
  notificationClient,
  notificationCategories,
} from '../../../../packages/client-core/src/notifications';
import type { Page } from '../../../../packages/client-core/src/invoices';
import type { NotificationItem } from '../../../../packages/client-core/src/notifications';
import { formatInstant } from '../../../../packages/client-core/src/localization';
import { Action, Box, Heading, Pill, ui } from '../components/WorkspaceKit';
import { ChoiceField } from '../components/WorkflowControls';
import { Pagination, QueryState } from '../components/WorkspaceQueryState';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { errorMessage } from '../lib/api';
import { useSession } from '../lib/SessionProvider';
import { notificationRefresh } from '../services/notificationRefresh';

export function NotificationsScreen() {
  const { api } = useSession();
  const { role, go } = useWorkspace();
  const [page, setPage] = useState(1),
    [category, setCategory] = useState(''),
    [unread, setUnread] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useFeedbackState();
  const lock = useRef(false);
  const query = useWorkspaceQuery<Page<NotificationItem>>(
    `/api/v1/notifications?page=${page}&pageSize=20${category ? '&category=' + category : ''}${unread ? '&unread=' + unread : ''}`,
  );
  const reload = query.reload;
  useEffect(() => {
    const timer = setInterval(() => reload(), 30000);
    return () => clearInterval(timer);
  }, [reload]);
  async function action(work: () => Promise<unknown>) {
    if (!api || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
      query.reload();
      notificationRefresh.emit();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function open(id: string) {
    if (!api) return;
    const client = notificationClient(api.request.bind(api));
    const target = await client.target(id);
    const params = { invoiceId: target.objectId };
    if (target.objectType === 'Invoice' && role === 'Tenant') {
      await client.read(id);
      go('invoice', params);
    } else if (target.objectType === 'Adjustment' && role === 'Tenant') {
      const request = await api.request<{ invoiceId: string }>(
        `/api/v1/invoice-adjustments/${encodeURIComponent(target.objectId)}`,
      );
      await client.read(id);
      go('invoice', { invoiceId: request.invoiceId });
    } else if (target.objectType === 'Contract' && role !== 'Staff') {
      await client.read(id);
      go(role === 'Tenant' ? 'contract' : 'signing', { contractId: target.objectId });
    } else if (target.objectType === 'MeterTask' && role === 'Staff') {
      await client.read(id);
      router.push({ pathname: '/meter', params: { taskId: target.objectId } });
    } else if (target.objectType === 'OperationalTask' && role !== 'Tenant') {
      await client.read(id);
      go('task-detail', { taskId: target.objectId });
    } else {
      setError(
        role === 'Tenant'
          ? 'Thông báo này chưa có màn hình chi tiết dành cho khách thuê. Bạn vẫn có thể đánh dấu đã đọc.'
          : 'Hồ sơ này được xử lý trên Owner Web. Mở đúng tài khoản Owner để tiếp tục.',
      );
    }
  }
  return (
    <>
      <IncidentInbox />
      <Heading
        title="Thông báo của tôi"
        detail="Hộp thông báo theo tài khoản, quyền hồ sơ được kiểm tra lại khi mở."
      />
      <ChoiceField
        label="Nhóm thông báo"
        value={category}
        options={[
          { id: '', label: 'Tất cả nhóm' },
          ...Object.entries(notificationCategories).map(([id, label]) => ({ id, label })),
        ]}
        onChange={(v) => {
          setCategory(v);
          setPage(1);
        }}
      />
      <ChoiceField
        label="Trạng thái đọc"
        value={unread}
        options={[
          { id: '', label: 'Tất cả' },
          { id: 'true', label: 'Chưa đọc' },
          { id: 'false', label: 'Đã đọc' },
        ]}
        onChange={(v) => {
          setUnread(v);
          setPage(1);
        }}
      />
      <QueryState {...query} />
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
      <Action
        secondary
        disabled={busy || !api}
        onPress={() => void action(() => notificationClient(api!.request.bind(api)).readAll())}
      >
        Đánh dấu tất cả đã đọc
      </Action>
      {query.data?.items.length === 0 && (
        <Box>
          <Text>Không có thông báo phù hợp.</Text>
        </Box>
      )}
      {query.data?.items.map((n) => (
        <Box key={n.id}>
          <Pill tone={n.readAt ? 'green' : 'blue'}>
            {n.readAt ? 'Đã đọc' : 'Chưa đọc'} ·{' '}
            {notificationCategories[n.category as keyof typeof notificationCategories] ??
              n.category}
          </Pill>
          <Heading title={n.title} detail={formatInstant(n.createdAt)} />
          <Text>{n.summary}</Text>
          <Action disabled={busy} onPress={() => void action(() => open(n.id))}>
            Mở hồ sơ liên quan
          </Action>
          {!n.readAt && (
            <Action
              secondary
              disabled={busy}
              onPress={() =>
                void action(() => notificationClient(api!.request.bind(api)).read(n.id))
              }
            >
              Đánh dấu đã đọc
            </Action>
          )}
        </Box>
      ))}
      {query.data && (
        <Pagination
          page={page}
          total={query.data.totalCount}
          loading={query.loading}
          onChange={setPage}
        />
      )}
    </>
  );
}
