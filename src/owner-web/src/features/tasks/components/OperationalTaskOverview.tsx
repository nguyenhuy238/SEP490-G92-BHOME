import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import { Check } from 'lucide-react';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import type { OwnerTask } from '../taskContracts';

type StepState = 'done' | 'current' | 'pending' | 'unknown';
const steps = ['Owner giao việc', 'Staff thực hiện', 'Staff gửi kết quả', 'Owner nghiệm thu'];

function workflowState(status: string, index: number): StepState {
  if (status === 'Completed') return 'done';
  if (status === 'Cancelled') return index === 0 ? 'done' : 'unknown';
  const current: Record<string, number> = { Assigned: 1, InProgress: 1, PendingVerification: 3 };
  const step = current[status];
  if (step === undefined) return 'unknown';
  if (index < step) return 'done';
  return index === step ? 'current' : 'pending';
}

export function OperationalTaskOverview({
  task,
  verifiedBy,
}: {
  task: OwnerTask;
  verifiedBy: string;
}) {
  return (
    <Stack spacing={2}>
      <Box component="section" aria-label="Quy trình công việc">
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 1.25 }}>
          Quy trình công việc
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, minmax(0, 1fr))',
              sm: 'repeat(4, minmax(0, 1fr))',
            },
            gap: 1,
          }}
        >
          {steps.map((step, index) => {
            const progress = workflowState(task.status, index);
            const done = progress === 'done';
            const current = progress === 'current';
            return (
              <Stack
                key={step}
                direction="row"
                spacing={0.75}
                data-testid={`operational-step-${index + 1}`}
                data-state={progress}
                aria-current={current ? 'step' : undefined}
                sx={{
                  alignItems: 'center',
                  minWidth: 0,
                  py: 0.75,
                  borderTop: 2,
                  borderColor: done ? 'success.main' : current ? 'primary.main' : 'divider',
                }}
              >
                <Box
                  sx={{
                    display: 'inline-flex',
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    flexShrink: 0,
                    alignItems: 'center',
                    justifyContent: 'center',
                    bgcolor: done ? 'success.main' : current ? 'primary.main' : 'action.hover',
                    color: done || current ? 'common.white' : 'text.secondary',
                  }}
                >
                  {done ? (
                    <Check size={14} aria-label={`Đã hoàn tất bước ${index + 1}`} />
                  ) : (
                    <Typography variant="caption" sx={{ fontWeight: 600 }}>
                      {index + 1}
                    </Typography>
                  )}
                </Box>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: done || current ? 650 : 400,
                    color: done ? 'success.dark' : current ? 'primary.main' : 'text.secondary',
                  }}
                >
                  {step}
                </Typography>
              </Stack>
            );
          })}
        </Box>
      </Box>

      {!task.responsibilityAvailable &&
        task.status !== 'Completed' &&
        task.status !== 'Cancelled' && (
          <Alert severity="warning" variant="outlined">
            Cơ sở chưa có người phụ trách.{' '}
            <Button href="/staff-assignments">Mở phân công cơ sở</Button>
          </Alert>
        )}

      <Box component="section" sx={{ borderTop: 1, borderColor: 'divider', pt: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
          Yêu cầu công việc
        </Typography>
        <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {task.requirements || 'Chưa có mô tả yêu cầu.'}
        </Typography>
      </Box>

      <Box component="section" sx={{ borderTop: 1, borderColor: 'divider', pt: 1.5 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.75 }}>
          Kết quả Staff
        </Typography>
        <Typography
          variant="body2"
          sx={{
            whiteSpace: 'pre-wrap',
            overflowWrap: 'anywhere',
            color: task.result?.trim() ? 'text.primary' : 'text.secondary',
          }}
        >
          {task.result?.trim() || 'Chưa có kết quả từ nhân viên.'}
        </Typography>
        {task.verifiedAt && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            Owner nghiệm thu: {formatInstant(task.verifiedAt)} · {verifiedBy}
          </Typography>
        )}
      </Box>
    </Stack>
  );
}
