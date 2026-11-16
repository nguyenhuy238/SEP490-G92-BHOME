import React, { useRef, useState } from 'react';
import { Checkbox, Text } from 'react-native-paper';
import { Action, Box, Heading } from '../../components/WorkspaceKit';
import { ChoiceField, Input } from '../../components/WorkflowControls';
import { QueryState } from '../../components/WorkspaceQueryState';
import { ContractDateField } from '../../components/ContractDateField';
import { useSession } from '../../lib/SessionProvider';
import { useWorkspace } from './WorkspaceProvider';
import { useWorkspaceQuery } from './useWorkspaceQuery';
import {
  equipmentInspectionClient,
  initialInspectionAnswers,
  inspectionLabels,
  type EquipmentInspection,
  type InspectionAnswer,
} from '../../../../../packages/client-core/src/equipmentInspections';
import { lifecycleError } from '../../../../../packages/client-core/src/assetLifecycle';
import type { SetupDocument } from '../../../../../packages/client-core/src/propertySetup';
import { inputDate } from '../../../../../packages/client-core/src/contracts';

export function EquipmentInspectionPanel({
  taskId,
  evidence = [],
  onSaved,
}: {
  taskId: string;
  evidence?: { id: string }[];
  onSaved: () => void;
}) {
  const query = useWorkspaceQuery<SetupDocument<EquipmentInspection> | null>(
    `/api/v1/operational-tasks/${taskId}/equipment-inspection`,
  );
  return (
    <>
      <QueryState {...query} />
      {query.data?.kind === 'EquipmentInspection' && (
        <InspectionContent
          key={`${query.data.id}:${query.data.version}`}
          record={query.data}
          evidence={evidence}
          onSaved={() => {
            query.reload();
            onSaved();
          }}
        />
      )}
    </>
  );
}

function InspectionContent({
  record,
  evidence,
  onSaved,
}: {
  record: SetupDocument<EquipmentInspection>;
  evidence: { id: string }[];
  onSaved: () => void;
}) {
  const { api } = useSession();
  const { role, go } = useWorkspace();
  const [answers, setAnswers] = useState(() => initialInspectionAnswers(record.data));
  const [note, setNote] = useState('');
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const service = api ? equipmentInspectionClient((path, init) => api.request(path, init)) : null;
  async function perform(action: 'Save' | 'Submit' | 'Verify' | 'Rework' | 'Remediate') {
    if (!service || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (action === 'Save' || action === 'Submit')
        await service.save(record.id, record.version, answers, action === 'Submit');
      else if (action === 'Remediate')
        await service.remediate(
          record.id,
          record.version,
          note,
          'Khắc phục và kiểm tra lại thiết bị',
          `${inputDate(deadline)}T23:59:59+07:00`,
        );
      else await service.review(record.id, record.version, action, note);
      onSaved();
    } catch (failure) {
      setError(lifecycleError(failure));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function change(index: number, update: Partial<InspectionAnswer>) {
    setAnswers((items) =>
      items.map((item, position) => (position === index ? { ...item, ...update } : item)),
    );
  }
  const data = record.data;
  const editable = role === 'Staff' && record.status === 'Draft';
  return (
    <Box>
      <Heading
        title="Kiểm tra thiết bị"
        detail={`${inspectionLabels[record.status]} · ${inspectionLabels[data.outcome]}`}
      />
      {data.progress && (
        <Text>
          Đã kiểm tra {data.progress.inspected}/{data.progress.total} · Đạt {data.progress.passed} ·
          Không đạt {data.progress.failed} · Chưa kiểm tra {data.progress.notInspected}
        </Text>
      )}
      <Text>
        {data.policySnapshot.name} · Phiên bản {data.policyVersion}
      </Text>
      {data.units.map((unit) => (
        <Box key={unit.id}>
          <Heading title={unit.label} detail={unit.position} />
          {answers.map((answer, index) =>
            answer.unitId !== unit.id ? null : (
              <React.Fragment key={answer.checklistCode}>
                <ChoiceField
                  label={
                    data.policySnapshot.checklist.find((item) => item.code === answer.checklistCode)
                      ?.label ?? answer.checklistCode
                  }
                  value={answer.result}
                  options={['NotInspected', 'Passed', 'Failed', 'NotApplicable'].map((id) => ({
                    id,
                    label: inspectionLabels[id],
                  }))}
                  disabled={busy || !editable}
                  onChange={(result) => change(index, { result })}
                />
                <Input
                  label="Ghi chú / lý do không áp dụng"
                  value={answer.note ?? ''}
                  disabled={busy || !editable}
                  onChange={(value) => change(index, { note: value })}
                />
              </React.Fragment>
            ),
          )}
          {editable &&
            evidence.map((file, fileIndex) => (
              <Checkbox.Item
                key={file.id}
                label={`Ảnh minh chứng ${fileIndex + 1}`}
                status={
                  answers.some(
                    (answer) => answer.unitId === unit.id && answer.evidenceIds.includes(file.id),
                  )
                    ? 'checked'
                    : 'unchecked'
                }
                disabled={busy}
                onPress={() =>
                  setAnswers((items) =>
                    items.map((answer) =>
                      answer.unitId !== unit.id
                        ? answer
                        : {
                            ...answer,
                            evidenceIds: answer.evidenceIds.includes(file.id)
                              ? answer.evidenceIds.filter((id) => id !== file.id)
                              : [...answer.evidenceIds, file.id],
                          },
                    ),
                  )
                }
              />
            ))}
        </Box>
      ))}
      {!!data.reviewNote && <Text>Ghi chú Owner · {data.reviewNote}</Text>}
      {!!error && <Text accessibilityRole="alert">{error}</Text>}
      {editable && (
        <>
          <Action disabled={busy} onPress={() => void perform('Save')}>
            Lưu tiến độ kiểm tra
          </Action>
          <Action disabled={busy} onPress={() => void perform('Submit')}>
            Gửi kết quả kiểm tra cho Owner
          </Action>
        </>
      )}
      {role === 'Owner' && record.status === 'Submitted' && (
        <>
          <Input label="Ghi chú xác minh" value={note} onChange={setNote} disabled={busy} />
          <Action disabled={busy || !note.trim()} onPress={() => void perform('Verify')}>
            Xác minh kết quả kiểm tra
          </Action>
          <Action secondary disabled={busy || !note.trim()} onPress={() => void perform('Rework')}>
            Yêu cầu kiểm tra lại
          </Action>
        </>
      )}
      {role === 'Owner' &&
        record.status === 'Verified' &&
        data.outcome === 'Failed' &&
        !data.remediationWorkOrderId && (
          <>
            <Input label="Vấn đề cần khắc phục" value={note} onChange={setNote} disabled={busy} />
            <ContractDateField
              label="Hạn khắc phục"
              value={deadline}
              onChange={setDeadline}
              disabled={busy}
            />
            <Action
              disabled={busy || !note.trim() || !deadline}
              onPress={() => void perform('Remediate')}
            >
              Tạo bảo trì chủ động
            </Action>
          </>
        )}
      {data.remediationWorkOrderId && (
        <Action
          secondary
          onPress={() => go('maintenance-detail', { workOrderId: data.remediationWorkOrderId! })}
        >
          Theo dõi bảo trì
        </Action>
      )}
    </Box>
  );
}
