import React, { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { Text } from 'react-native-paper';
import { Action, Box, Heading, Pill, Row, ui } from '../components/WorkspaceKit';
import { MeterFlowHeader } from '../components/MeterFlowHeader';
import { ChoiceField, Input } from '../components/WorkflowControls';
import { QueryState } from '../components/WorkspaceQueryState';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useSession } from '../lib/SessionProvider';
import { errorMessage, type MeterTask, type Named } from '../lib/api';
import { displayContractDate } from '../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../packages/client-core/src/localization';

export function MeterTasksScreen() {
  const { api, session } = useSession();
  const staff = session?.roles.includes('Staff');
  const [location, setLocation] = useState('');
  const [room, setRoom] = useState('');
  const [period, setPeriod] = useState('');
  const [due, setDue] = useState('');
  const [status, setStatus] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState<{
    api: typeof api;
    key: string;
    data: MeterTask[];
    error: string;
  } | null>(null);
  const locations = useWorkspaceQuery<Named[]>(staff ? '/api/v1/capture/locations' : null);
  const rooms = useWorkspaceQuery<Named[]>(
    staff && location ? `/api/v1/capture/locations/${encodeURIComponent(location)}/rooms` : null,
  );
  const validDue =
    !due ||
    (/^\d{4}-\d{2}-\d{2}$/.test(due) &&
      !Number.isNaN(Date.parse(due)) &&
      new Date(due).toISOString().slice(0, 10) === due);
  const params = new URLSearchParams();
  if (location) params.set('locationId', location);
  if (room) params.set('roomId', room);
  if (status) params.set('status', status);
  if (due && validDue) params.set('dueDate', due);
  const scope = params.toString();
  const key = scope + ':' + revision;
  const reload = useCallback(() => setRevision((v) => v + 1), []);
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );
  useEffect(() => {
    if (!api || !staff || !validDue) return;
    const controller = new AbortController();
    void (async () => {
      try {
        // The existing API has no billingPeriod filter. Collect its scoped pages
        // before filtering periods locally, so later pages cannot be omitted.
        const data: MeterTask[] = [];
        for (let serverPage = 1; ; serverPage++) {
          const batch = await api.request<MeterTask[]>(
            `/api/v1/capture/meter-tasks?page=${serverPage}${scope ? '&' + scope : ''}`,
            { signal: controller.signal },
          );
          if (controller.signal.aborted) return;
          data.push(...batch);
          if (batch.length < 100) break;
        }
        setState({ api, key, data, error: '' });
      } catch (e) {
        if (!controller.signal.aborted) setState({ api, key, data: [], error: errorMessage(e) });
      }
    })();
    return () => controller.abort();
  }, [api, staff, scope, key, validDue]);
  const current = state?.key === key && validDue && state.api === api ? state : null;
  const loading = !!api && !!staff && validDue && !current;
  const all = current?.data ?? [];
  const periods = [
    ...new Set(all.map((task) => task.billingPeriod).filter((p): p is string => !!p)),
  ]
    .sort()
    .reverse();
  const filtered = all.filter((task) => !period || task.billingPeriod === period);
  const visiblePage = Math.min(page, Math.max(1, Math.ceil(filtered.length / 20)));
  const items = filtered.slice((visiblePage - 1) * 20, visiblePage * 20);
  const change = (setter: (v: string) => void, v: string) => {
    setter(v);
    setPage(1);
  };
  if (!staff) return <Text>Chỉ Staff được phép ghi chỉ số điện nước.</Text>;
  return (
    <>
      <MeterFlowHeader step={0} />
      <Box style={{ padding: 14, gap: 10 }}>
        <ChoiceField
          label="Cơ sở"
          value={location}
          options={[{ id: '', label: 'Tất cả cơ sở được phép' }, ...(locations.data ?? [])]}
          onChange={(v) => {
            change(setLocation, v);
            setRoom('');
            setPeriod('');
          }}
        />
        {(locations.loading || !!locations.error) && <QueryState {...locations} />}
        <ChoiceField
          label="Phòng lọc tác vụ"
          value={room}
          disabled={!location || rooms.loading}
          options={[{ id: '', label: 'Tất cả phòng' }, ...(rooms.data ?? [])]}
          onChange={(v) => {
            change(setRoom, v);
            setPeriod('');
          }}
        />
        {(rooms.loading || !!rooms.error) && <QueryState {...rooms} />}
        <Action secondary onPress={() => setExpanded(!expanded)}>
          {expanded ? 'Thu gọn bộ lọc' : 'Lọc kỳ ghi & trạng thái'}
        </Action>
        {expanded && (
          <>
            <ChoiceField
              label="Kỳ ghi chỉ số"
              value={period}
              options={[
                { id: '', label: 'Tất cả kỳ ghi' },
                ...periods.map((p) => ({ id: p, label: displayContractDate(p) })),
              ]}
              onChange={(v) => change(setPeriod, v)}
            />
            <ChoiceField
              label="Trạng thái tác vụ"
              value={status}
              options={[
                { id: '', label: 'Tất cả' },
                { id: '0', label: 'Được giao' },
                { id: '1', label: 'Đang xử lý' },
                { id: '2', label: 'Đã xác nhận' },
                { id: '3', label: 'Đã hủy' },
              ]}
              onChange={(v) => {
                change(setStatus, v);
                setPeriod('');
              }}
            />
            <Input
              label="Hạn ghi số (yyyy-MM-dd)"
              value={due}
              onChange={(v) => {
                change(setDue, v);
                setPeriod('');
              }}
            />
            {!validDue && <Text style={ui.red}>Nhập ngày hợp lệ theo yyyy-MM-dd.</Text>}
          </>
        )}
        {!!(location || room || period || due || status) && (
          <Action
            secondary
            onPress={() => {
              setLocation('');
              setRoom('');
              setPeriod('');
              setDue('');
              setStatus('');
              setPage(1);
            }}
          >
            Xóa bộ lọc
          </Action>
        )}
      </Box>
      <Heading
        title="Tác vụ được phân công"
        detail={
          current && !current.error
            ? `${filtered.length} tác vụ phù hợp`
            : 'Dữ liệu theo quyền truy cập hiện tại'
        }
      />
      <QueryState loading={loading} error={current?.error ?? ''} reload={reload} />
      {items.map((task) => (
        <Box key={task.id} style={{ padding: 14, gap: 8 }}>
          <Row spread>
            <Text variant="titleLarge">Phòng {task.room}</Text>
            <Pill tone={task.utilityType === 0 ? 'amber' : 'blue'}>
              {task.utilityType === 0 ? 'Điện · kWh' : 'Nước · m³'}
            </Pill>
          </Row>
          <Text style={ui.muted}>
            {task.location} · {task.meterCode}
          </Text>
          <Pill tone={task.status === 2 ? 'green' : 'blue'}>
            {['Được giao', 'Đang xử lý', 'Đã xác nhận', 'Đã hủy'][task.status] ?? 'Không xác định'}
          </Pill>
          <Text>
            Kỳ ghi:{' '}
            {task.purpose === 0
              ? 'Chỉ số ban đầu'
              : task.purpose === 2
                ? 'Chốt trả phòng'
                : displayContractDate(task.billingPeriod ?? task.readingDate)}
          </Text>
          <Text>
            Chỉ số trước: {task.previousValue ?? 'Chưa có'}{' '}
            {task.previousValue !== null ? (task.utilityType === 0 ? 'kWh' : 'm³') : ''}
          </Text>
          {task.dueAt && <Text style={ui.muted}>Hạn ghi: {formatInstant(task.dueAt)}</Text>}
          {task.status < 2 && (
            <Action
              icon="camera-outline"
              onPress={() => router.push({ pathname: '/meter', params: { taskId: task.id } })}
            >
              Ghi chỉ số
            </Action>
          )}
          {task.status === 2 && (
            <Action
              secondary
              onPress={() => router.push({ pathname: '/meter', params: { taskId: task.id } })}
            >
              Xem kết quả đã xác nhận
            </Action>
          )}
        </Box>
      ))}
      {current && !current.error && !items.length && (
        <Box>
          <Heading title="Chưa có tác vụ phù hợp" />
          <Text>Đổi phòng hoặc kỳ ghi, rồi tải lại.</Text>
        </Box>
      )}
      {filtered.length > 20 && (
        <Row>
          <Action
            secondary
            disabled={visiblePage === 1 || loading}
            onPress={() => setPage(visiblePage - 1)}
          >
            Trang trước
          </Action>
          <Text>
            Trang {visiblePage} / {Math.ceil(filtered.length / 20)}
          </Text>
          <Action
            secondary
            disabled={visiblePage * 20 >= filtered.length || loading}
            onPress={() => setPage(visiblePage + 1)}
          >
            Trang sau
          </Action>
        </Row>
      )}
    </>
  );
}
