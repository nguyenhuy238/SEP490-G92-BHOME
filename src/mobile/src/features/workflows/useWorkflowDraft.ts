import { useState } from 'react';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { validateWorkflow, type Draft, type WorkflowKind } from './validation';
export function useWorkflowDraft(kind: WorkflowKind, initial: Draft) {
  const { preview, recordPreviewRequest } = useWorkspace();
  const [data, setData] = useState(initial);
  const [evidence, setEvidence] = useState(0);
  const [errors, setErrors] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  return {
    data,
    evidence,
    errors,
    submitted,
    busy,
    setEvidence,
    setSubmitted,
    change: (key: string, value: string) => {
      setData((before) => ({ ...before, [key]: value }));
      setSubmitted(false);
    },
    submit: async () => {
      if (busy) return;
      const failures = validateWorkflow(kind, data, evidence);
      setErrors(failures);
      if (failures.length) return;
      setBusy(true);
      try {
        if (!preview) {
          setErrors([
            'Chưa có API lưu nghiệp vụ. Bản nháp chưa được gửi; trạng thái dữ liệu thật không thay đổi.',
          ]);
          return;
        }
        await Promise.resolve();
        recordPreviewRequest(
          kind,
          data.reason || data.note || data.description || 'Bản mẫu đã gửi để kiểm tra giao diện',
        );
        setSubmitted(true);
      } finally {
        setBusy(false);
      }
    },
  };
}
