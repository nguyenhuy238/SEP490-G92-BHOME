import React, { useRef, useState } from 'react';
import { Text } from 'react-native-paper';
import { Action, Box, Heading } from '../components/WorkspaceKit';
import { ChoiceField, Input } from '../components/WorkflowControls';
import { Pagination, QueryState } from '../components/WorkspaceQueryState';
import { useWorkspaceQuery } from '../features/workspace/useWorkspaceQuery';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useSession } from '../lib/SessionProvider';
import { randomUUID } from '../lib/randomUUID';
import {
  dataRequestStatuses,
  dataRequestTypes,
  taxPrivacyClient,
  type PersonalDataRequest,
} from '../../../../packages/client-core/src/taxPrivacy';
import { lifecycleError } from '../../../../packages/client-core/src/assetLifecycle';
import { formatInstant } from '../../../../packages/client-core/src/localization';

export function PersonalDataRequestsScreen() {
  const { api } = useSession();
  const { role } = useWorkspace();
  const [page, setPage] = useState(1);
  const [type, setType] = useState('Access');
  const [description, setDescription] = useState('');
  const [id, setId] = useState(() => randomUUID());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const query = useWorkspaceQuery<{ items: PersonalDataRequest[]; totalCount: number }>(
    `/api/v1/personal-data-requests?page=${page}`,
  );
  async function create() {
    if (!api || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await taxPrivacyClient((path, init) => api.request(path, init)).createRequest(
        id,
        type,
        description,
      );
      setId(randomUUID());
      setDescription('');
      query.reload();
    } catch (failure) {
      setError(lifecycleError(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title="Yêu cầu dữ liệu cá nhân" />
      {role !== 'Owner' && (
        <Box>
          <ChoiceField
            label="Loại yêu cầu"
            value={type}
            options={dataRequestTypes}
            disabled={busy}
            onChange={(value) => {
              setType(value);
              setId(randomUUID());
            }}
          />
          <Input
            label="Nội dung và phạm vi yêu cầu"
            value={description}
            disabled={busy}
            onChange={(value) => {
              setDescription(value);
              setId(randomUUID());
            }}
          />
          {!!error && <Text accessibilityRole="alert">{error}</Text>}
          <Action
            disabled={busy || !description.trim() || description.length > 2000}
            onPress={() => void create()}
          >
            {busy ? 'Đang gửi…' : 'Gửi yêu cầu dữ liệu'}
          </Action>
        </Box>
      )}
      <QueryState {...query} />
      {query.data?.totalCount === 0 && <Text>Chưa có yêu cầu dữ liệu cá nhân.</Text>}
      {query.data?.items.map((item) => (
        <Box key={`${item.requestedBy}:${item.id}`}>
          <Heading
            title={
              dataRequestTypes.find((type) => type.id === item.requestType)?.label ??
              'Yêu cầu dữ liệu'
            }
            detail={dataRequestStatuses[item.status]}
          />
          {role === 'Owner' && <Text>{item.requesterLabel || 'Tài khoản gửi yêu cầu'}</Text>}
          <Text>{item.description}</Text>
          <Text>{formatInstant(item.requestedAt)}</Text>
          {item.history
            .filter((entry) => entry.resolution)
            .map((entry, index) => (
              <Text key={index}>
                {entry.resolution} · Căn cứ {entry.basis}
              </Text>
            ))}
          {role === 'Owner' && ['Pending', 'InReview'].includes(item.status) && (
            <DataRequestDecision item={item} onSaved={query.reload} />
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

function DataRequestDecision({
  item,
  onSaved,
}: {
  item: PersonalDataRequest;
  onSaved: () => void;
}) {
  const { api } = useSession();
  const [status, setStatus] = useState('InReview');
  const [resolution, setResolution] = useState('');
  const [basis, setBasis] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  async function save() {
    if (!api || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await taxPrivacyClient((path, init) => api.request(path, init)).decideRequest(
        item,
        status,
        resolution,
        basis,
      );
      onSaved();
    } catch (failure) {
      setError(lifecycleError(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <>
      <ChoiceField
        label="Kết quả xử lý"
        value={status}
        disabled={busy}
        onChange={setStatus}
        options={['InReview', 'Resolved', 'Rejected'].map((id) => ({
          id,
          label: dataRequestStatuses[id],
        }))}
      />
      <Input
        label="Phản hồi / hành động đã thực hiện"
        value={resolution}
        onChange={setResolution}
        disabled={busy}
      />
      <Input
        label="Căn cứ và dữ liệu cần giữ lại"
        value={basis}
        onChange={setBasis}
        disabled={busy}
      />
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
      <Action disabled={busy || !resolution.trim() || !basis.trim()} onPress={() => void save()}>
        Lưu phản hồi
      </Action>
    </>
  );
}
