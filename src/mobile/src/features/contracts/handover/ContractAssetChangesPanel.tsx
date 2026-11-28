import { ContractNotice } from '../ContractNotice';
import React, { useRef, useState } from 'react';
import { Checkbox, Text } from 'react-native-paper';
import {
  businessToday,
  contractError,
  dateOnly,
  displayContractDate,
  mutationKeys,
  type ContractClient,
  type ContractView,
} from '../../../../../../packages/client-core/src/contracts';
import { handoverQuantity } from '../../../../../../packages/client-core/src/handoverForm';
import { useContractAssetChanges } from '../../../../../../packages/client-core/src/useContractAssetChanges';
import { Action, Heading } from '../../../components/WorkspaceKit';
import { Input, ChoiceField } from '../../../components/WorkflowControls';
import { CameraCapture } from '../../../components/CameraCapture';
import { randomUUID } from '../../../lib/randomUUID';
import { ContractEvidence } from '../ContractEvidence';

const kinds: Record<string, string> = {
  Supplement: 'Bổ sung',
  Replacement: 'Thay thế',
  Withdrawal: 'Thu hồi',
};
export function ContractAssetChangesPanel({
  api,
  contract,
  role,
}: {
  api: ContractClient;
  contract: ContractView;
  role: string;
}) {
  const staff = role === 'Staff' && contract.status === 'Active';
  const q = useContractAssetChanges(api, contract.id, staff);
  const [values, setValues] = useState<Record<string, string>>({ kind: 'Supplement' }),
    [selected, setSelected] = useState<string[]>([]),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [keys] = useState(() => mutationKeys(randomUUID)),
    lock = useRef(false);
  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));
  async function run(operation: string, body: Record<string, unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api.mutate(contract.id, operation, body, keys.get(operation, body));
      keys.confirmed(operation, body);
      q.reload();
      setEditing(false);
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const groups = [
    ...(q.preparation?.baseline?.assets ?? []),
    ...(q.preparation?.inventory.groups ?? []),
  ].filter((a, index, all) => all.findIndex((b) => b.id === a.id) === index);
  const physical =
    q.preparation?.inventory.groups.flatMap((a) =>
      (a.physicalAssets ?? []).map((p) => ({ ...p, name: a.name })),
    ) ?? [];
  const previous =
    q.preparation?.baseline?.assets.flatMap((a) =>
      (a.physicalAssets ?? []).map((p) => ({ ...p, name: a.name })),
    ) ?? [];
  const source = q.preparation?.sources.find((s) => s.id === values.sourceId);
  return (
    <>
      <Heading
        title="Thay đổi tài sản trong thời gian thuê"
        detail="Giữ nguyên biên bản nhận phòng; Tenant xác nhận riêng từng thay đổi."
      />
      {q.loading && <Text>Đang tải lịch sử thay đổi tài sản…</Text>}
      {(q.error || error) && <ContractNotice message={q.error || error} />}
      {!q.loading && !q.events.length && (
        <Text>Chưa có bàn giao bổ sung, thay thế hoặc thu hồi.</Text>
      )}
      {q.events.map((event) => {
        const acknowledgement = event.data.acknowledgements.find(
          (a) => a.contractId === (event.acknowledgementContractId ?? contract.id),
        );
        return (
          <React.Fragment key={event.id}>
            <Text variant="titleSmall">
              {kinds[event.data.kind]} · {displayContractDate(event.data.date)}
            </Text>
            <Text>{event.data.reason}</Text>
            {event.data.lines.map((line) => (
              <Text key={line.groupId}>
                {event.data.assets.find((a) => a.id === line.groupId)?.name}: thêm{' '}
                {line.addedQuantity}, thu hồi {line.withdrawnQuantity} · {line.condition}
              </Text>
            ))}
            <Text>
              {acknowledgement
                ? `${acknowledgement.accepted ? 'Bạn đã xác nhận' : 'Bạn không đồng ý'} · ${acknowledgement.reason}`
                : 'Chờ Tenant của hợp đồng này xác nhận'}
            </Text>
            {event.data.lines.flatMap((line) =>
              line.evidenceIds.map((evidenceId, n) => (
                <ContractEvidence
                  key={`${line.groupId}-${evidenceId}`}
                  api={api}
                  contractId={contract.id}
                  assetChangeId={event.id}
                  evidenceId={evidenceId}
                  label={`${kinds[event.data.kind]} · Ảnh ${n + 1}`}
                />
              )),
            )}
            {role === 'Tenant' && contract.status === 'Active' && !acknowledgement?.accepted && (
              <>
                <Input
                  label="Ghi chú phản hồi tài sản bổ sung"
                  value={values[`response.${event.id}`] ?? ''}
                  onChange={(v) => set(`response.${event.id}`, v)}
                  disabled={busy}
                />
                <Checkbox.Item
                  label="Tôi đã kiểm tra thay đổi tài sản thực tế"
                  status={values[`checked.${event.id}`] === 'true' ? 'checked' : 'unchecked'}
                  onPress={() =>
                    set(
                      `checked.${event.id}`,
                      values[`checked.${event.id}`] === 'true' ? 'false' : 'true',
                    )
                  }
                  disabled={busy}
                />
                <Action
                  disabled={busy || values[`checked.${event.id}`] !== 'true'}
                  onPress={() =>
                    void run(`asset-changes/${event.id}/confirmation`, {
                      version: 1,
                      confirmed: true,
                      reason: values[`response.${event.id}`] ?? '',
                    })
                  }
                >
                  Xác nhận thay đổi tài sản
                </Action>
                <Action
                  secondary
                  disabled={
                    busy ||
                    values[`checked.${event.id}`] !== 'true' ||
                    !values[`response.${event.id}`]?.trim()
                  }
                  onPress={() =>
                    void run(`asset-changes/${event.id}/confirmation`, {
                      version: 1,
                      confirmed: false,
                      reason: values[`response.${event.id}`],
                    })
                  }
                >
                  Không đồng ý thay đổi tài sản
                </Action>
              </>
            )}
          </React.Fragment>
        );
      })}
      {staff && !editing && (
        <Action
          secondary
          disabled={q.loading || busy || !!q.error}
          onPress={() => setEditing(true)}
        >
          Lập bàn giao thay đổi tài sản
        </Action>
      )}
      {staff && editing && (
        <>
          <ChoiceField
            label="Loại thay đổi"
            value={values.kind}
            options={Object.entries(kinds).map(([id, label]) => ({ id, label }))}
            onChange={(v) => set('kind', v)}
            disabled={busy}
          />
          <ChoiceField
            label="Nguồn thay đổi từ quản lý tài sản / Work Order đã xác minh"
            value={values.sourceId ?? ''}
            options={(q.preparation?.sources ?? [])
              .filter((s) => values.kind !== 'Replacement' || !!s.workOrderId)
              .map((s) => ({ id: s.id, label: s.label || s.id }))}
            onChange={(v) => set('sourceId', v)}
            disabled={busy}
          />
          {source?.workOrderId && <Text>Work Order: {source.workOrderId}</Text>}
          <ChoiceField
            label="Nhóm tài sản bàn giao"
            value={values.groupId ?? ''}
            options={groups.map((a) => ({ id: a.id, label: a.name }))}
            onChange={(v) => set('groupId', v)}
            disabled={busy}
          />
          {values.kind !== 'Withdrawal' && (
            <>
              <ChoiceField
                label="Tài sản được thêm / thay mới"
                value={values.addedAssetId ?? ''}
                options={physical.map((p) => ({
                  id: p.id,
                  label: `${p.name} · ${p.quantity} · ${p.condition}`,
                }))}
                onChange={(v) => set('addedAssetId', v)}
                disabled={busy}
              />
              <Input
                label="Số lượng thêm"
                value={values.addedQuantity ?? ''}
                onChange={(v) => set('addedQuantity', v)}
                disabled={busy}
              />
            </>
          )}
          {values.kind !== 'Supplement' && (
            <>
              <ChoiceField
                label="Tài sản cũ / được thu hồi"
                value={values.removedAssetId ?? ''}
                options={previous.map((p) => ({
                  id: p.id,
                  label: `${p.name} · ${p.quantity} · ${p.condition}`,
                }))}
                onChange={(v) => set('removedAssetId', v)}
                disabled={busy}
              />
              <Input
                label="Số lượng thu hồi"
                value={values.withdrawnQuantity ?? ''}
                onChange={(v) => set('withdrawnQuantity', v)}
                disabled={busy}
              />
            </>
          )}
          <Input
            label="Tình trạng tài sản thay đổi"
            value={values.condition ?? ''}
            onChange={(v) => set('condition', v)}
            disabled={busy}
          />
          <Input
            label="Ngày bàn giao thay đổi"
            value={values.date ?? displayContractDate(businessToday())}
            onChange={(v) => set('date', v)}
            disabled={busy}
          />
          <Input
            label="Lý do bổ sung / thay thế / thu hồi"
            value={values.reason ?? ''}
            onChange={(v) => set('reason', v)}
            disabled={busy}
            multiline
          />
          <Checkbox.Item
            label="Ảnh không chứa giấy tờ cá nhân"
            status={values.safePhoto === 'true' ? 'checked' : 'unchecked'}
            onPress={() => set('safePhoto', values.safePhoto === 'true' ? 'false' : 'true')}
            disabled={busy}
          />
          <CameraCapture
            label="Chụp ảnh thay đổi tài sản"
            reviewBeforeSubmit
            disabled={busy || values.safePhoto !== 'true'}
            onCapture={async (bytes) => {
              setBusy(true);
              try {
                await api.uploadHandover(contract.id, bytes, 'image/jpeg');
                q.reload();
                set('safePhoto', 'false');
              } catch (e) {
                setError(contractError(e));
              } finally {
                setBusy(false);
              }
            }}
          />
          {q.choices?.evidence.map((f, n) => (
            <Checkbox.Item
              key={f.id}
              label={`Ảnh thay đổi tài sản ${n + 1}`}
              status={selected.includes(f.id) ? 'checked' : 'unchecked'}
              onPress={() =>
                setSelected((v) =>
                  v.includes(f.id)
                    ? v.filter((id) => id !== f.id)
                    : v.length < 5
                      ? [...v, f.id]
                      : v,
                )
              }
              disabled={busy}
            />
          ))}
          <Action
            disabled={
              busy ||
              !selected.length ||
              !values.sourceId ||
              !values.groupId ||
              !values.condition?.trim() ||
              !values.reason?.trim()
            }
            onPress={() => {
              try {
                const body = {
                  sourceId: values.sourceId,
                  kind: values.kind,
                  date: dateOnly(values.date ?? businessToday()),
                  reason: values.reason,
                  inventoryToken: q.preparation!.inventory.stateToken,
                  lines: [
                    {
                      groupId: values.groupId,
                      addedAssetId: values.kind === 'Withdrawal' ? null : values.addedAssetId,
                      removedAssetId: values.kind === 'Supplement' ? null : values.removedAssetId,
                      addedQuantity:
                        values.kind === 'Withdrawal'
                          ? 0
                          : handoverQuantity(values.addedQuantity ?? '', 'Số lượng thêm'),
                      withdrawnQuantity:
                        values.kind === 'Supplement'
                          ? 0
                          : handoverQuantity(values.withdrawnQuantity ?? '', 'Số lượng thu hồi'),
                      condition: values.condition,
                      evidenceIds: selected,
                    },
                  ],
                };
                void run('asset-changes', body);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Gửi Tenant xác nhận thay đổi tài sản
          </Action>
          <Action secondary disabled={busy} onPress={() => setEditing(false)}>
            Đóng bàn giao thay đổi tài sản
          </Action>
        </>
      )}
      <Action secondary disabled={busy || q.loading} onPress={q.reload}>
        Tải lại thay đổi tài sản
      </Action>
    </>
  );
}
