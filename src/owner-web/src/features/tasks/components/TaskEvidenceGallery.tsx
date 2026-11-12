import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  Typography,
} from '@mui/material';
import { useMeterApi } from '../../meters/useMeterApi';
import { OwnerFeedback } from '../../../components/common/OwnerWorkspace';
import type { TaskEvidence } from '../taskContracts';
import { taskRoot } from '../useOperationalTasksApi';
function EvidenceImage({
  taskId,
  evidence,
  index,
}: {
  taskId: string;
  evidence: TaskEvidence;
  index: number;
}) {
  const { request } = useMeterApi();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    setError(undefined);
    setUrl('');
    void request<Blob>(
      `${taskRoot}/${taskId}/evidence/${evidence.id}`,
      { signal: controller.signal },
      'blob',
    )
      .then((blob) => {
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [taskId, evidence.id, attempt, request]);
  return (
    <Box sx={{ minWidth: 0 }}>
      {!!error ? (
        <>
          <OwnerFeedback error={error} />
          <Button onClick={() => setAttempt((value) => value + 1)}>Tải lại ảnh {index + 1}</Button>
        </>
      ) : !url ? (
        <LinearProgress aria-label="Đang tải ảnh" />
      ) : (
        <Button
          aria-label={`Xem ảnh bằng chứng ${index + 1}`}
          onClick={() => setOpen(true)}
          sx={{ p: 0, width: '100%' }}
        >
          <Box
            component="img"
            src={url}
            alt={`Bằng chứng ${index + 1}`}
            sx={{ width: '100%', height: 140, objectFit: 'cover', borderRadius: '8px' }}
          />
        </Button>
      )}
      <Typography sx={{ fontSize: 12, mt: 0.5 }}>
        {evidence.submissionId ? 'Đã chọn khi nộp kết quả' : 'Ảnh tiến độ / chưa chọn nộp'}
      </Typography>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md">
        <DialogTitle>
          Ảnh bằng chứng {index + 1}
          <Button onClick={() => setOpen(false)}>Đóng ảnh</Button>
        </DialogTitle>
        <DialogContent>
          <Box
            component="img"
            src={url}
            alt={`Bằng chứng ${index + 1} phóng lớn`}
            sx={{ width: '100%', maxHeight: '75vh', objectFit: 'contain' }}
          />
        </DialogContent>
      </Dialog>
    </Box>
  );
}
export function TaskEvidenceGallery({
  taskId,
  evidence,
}: {
  taskId: string;
  evidence: TaskEvidence[];
}) {
  if (!evidence.length)
    return (
      <Typography sx={{ fontSize: 14 }} color="text.secondary">
        Chưa có bằng chứng được tải lên.
      </Typography>
    );
  return (
    <Stack sx={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 2 }}>
      {evidence.map((item, index) => (
        <EvidenceImage key={item.id} taskId={taskId} evidence={item} index={index} />
      ))}
    </Stack>
  );
}
