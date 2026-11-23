import { alpha } from '@mui/material/styles';
import { Alert, Box, Button, Chip, Stack, Typography } from '@mui/material';
import {
  Check,
  CheckCircle2,
  ClipboardList,
  FileCheck2,
  Hourglass,
  ListChecks,
} from 'lucide-react';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import { OwnerFeedback } from '../../../components/common/OwnerWorkspace';
import type { OwnerTask, TaskEvidence } from '../taskContracts';
import { TaskEvidenceGallery } from './TaskEvidenceGallery';

type StepState = 'done' | 'current' | 'pending' | 'unknown';

const steps = [
  { label: 'Owner giao việc', detail: 'Nội dung và người phụ trách' },
  { label: 'Staff thực hiện', detail: 'Xử lý tại cơ sở' },
  { label: 'Staff gửi kết quả', detail: 'Báo cáo hoàn thành' },
  { label: 'Owner nghiệm thu', detail: 'Kiểm tra và xác nhận' },
];

function workflowState(status: string, index: number): StepState {
  if (status === 'Completed') return 'done';
  if (status === 'Cancelled') return index === 0 ? 'done' : 'unknown';
  const current: Record<string, number> = { Assigned: 1, InProgress: 1, PendingVerification: 3 };
  const step = current[status];
  if (step === undefined) return 'unknown';
  if (index < step) return 'done';
  return index === step ? 'current' : 'pending';
}

function overviewState(status: string) {
  switch (status) {
    case 'Assigned':
      return {
        title: 'Đã giao việc · Chờ Staff bắt đầu',
        description: 'Owner đã giao yêu cầu. Staff sẽ thực hiện và cập nhật kết quả trên ứng dụng.',
        tone: 'default' as const,
      };
    case 'InProgress':
      return {
        title: 'Staff đang thực hiện công việc',
        description:
          'Theo dõi tiến độ và bằng chứng Staff bổ sung. Chỉ nghiệm thu sau khi Staff nộp kết quả.',
        tone: 'info' as const,
      };
    case 'PendingVerification':
      return {
        title: 'Owner cần kiểm tra và nghiệm thu',
        description:
          'Staff đã gửi kết quả. Đối chiếu nội dung, bằng chứng rồi nghiệm thu hoặc yêu cầu làm lại.',
        tone: 'warning' as const,
      };
    case 'Completed':
      return {
        title: 'Công việc đã hoàn thành và nghiệm thu',
        description:
          'Kết quả đã được Owner xác nhận. Bạn có thể xem lại nội dung, bằng chứng và lịch sử.',
        tone: 'success' as const,
      };
    case 'Cancelled':
      return {
        title: 'Công việc đã hủy',
        description:
          'Không còn bước xử lý tiếp theo. Lịch sử và bằng chứng đã ghi nhận vẫn được giữ lại.',
        tone: 'default' as const,
      };
    default:
      return {
        title: 'Đang đối chiếu trạng thái công việc',
        description: 'Xem lịch sử để xác định tiến độ thực tế trước khi thao tác.',
        tone: 'default' as const,
      };
  }
}

export function OperationalTaskOverview({
  task,
  evidence,
  evidenceFetching,
  evidenceError,
  showEvidenceGallery,
  onRetryEvidence,
  onOpenHistory,
  onVerify,
  verifiedBy,
}: {
  task: OwnerTask;
  evidence?: TaskEvidence[];
  evidenceFetching: boolean;
  evidenceError: unknown;
  showEvidenceGallery: boolean;
  onRetryEvidence: () => void;
  onOpenHistory: () => void;
  onVerify: () => void;
  verifiedBy: string;
}) {
  const state = overviewState(task.status);
  const submitted = task.status === 'PendingVerification' || task.status === 'Completed';
  const evidenceCount = evidence?.length ?? 0;
  const showEvidence = task.evidenceRequired || evidenceCount > 0;

  return (
    <Stack spacing={2.5}>
      <Box component="section">
        <Typography sx={{ fontWeight: 700, fontSize: 17, mb: 1.25 }}>
          Quy trình công việc
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, minmax(0, 1fr))',
              md: 'repeat(4, minmax(0, 1fr))',
            },
            gap: 1,
          }}
        >
          {steps.map((step, index) => {
            const progress = workflowState(task.status, index);
            const done = progress === 'done';
            const current = progress === 'current';
            return (
              <Box
                key={step.label}
                data-testid={`operational-step-${index + 1}`}
                data-state={progress}
                aria-current={current ? 'step' : undefined}
                sx={{
                  p: 1.5,
                  minWidth: 0,
                  border: 1,
                  borderColor: done ? 'success.main' : current ? 'primary.main' : 'divider',
                  borderRadius: 1.5,
                  bgcolor: (theme) =>
                    done
                      ? alpha(theme.palette.success.main, 0.08)
                      : current
                        ? alpha(theme.palette.primary.main, 0.06)
                        : 'background.paper',
                }}
              >
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                  <Box
                    sx={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 23,
                      height: 23,
                      borderRadius: '50%',
                      border: done || current ? 0 : 1,
                      borderColor: 'divider',
                      bgcolor: done ? 'success.main' : current ? 'primary.main' : 'transparent',
                      color: done || current ? 'common.white' : 'text.secondary',
                      flexShrink: 0,
                    }}
                  >
                    {done ? (
                      <Check
                        size={15}
                        strokeWidth={3}
                        aria-label={`Đã hoàn tất bước ${index + 1}`}
                      />
                    ) : (
                      <Typography
                        component="span"
                        sx={{ fontSize: 12, fontWeight: 700, color: 'inherit' }}
                      >
                        {index + 1}
                      </Typography>
                    )}
                  </Box>
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: done || current ? 700 : 500,
                      color: done ? 'success.dark' : current ? 'primary.main' : 'text.secondary',
                    }}
                  >
                    {done
                      ? 'Hoàn tất'
                      : current
                        ? task.status === 'Assigned'
                          ? 'Chờ thực hiện'
                          : 'Đang xử lý'
                        : progress === 'unknown'
                          ? 'Chưa xác minh'
                          : 'Chưa tới'}
                  </Typography>
                </Stack>
                <Typography
                  sx={{ fontSize: 14, fontWeight: done || current ? 750 : 600, mt: 0.75 }}
                >
                  {step.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {step.detail}
                </Typography>
              </Box>
            );
          })}
        </Box>
      </Box>

      <Box
        component="section"
        data-testid="operational-current-status"
        data-tone={state.tone}
        sx={{
          border: 1,
          borderColor: state.tone === 'default' ? 'divider' : `${state.tone}.main`,
          bgcolor: (theme) =>
            state.tone === 'default'
              ? 'background.paper'
              : alpha(theme.palette[state.tone].main, 0.07),
          p: 2,
          borderRadius: 1.5,
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1.5}
          sx={{ alignItems: { sm: 'center' }, justifyContent: 'space-between' }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              {task.status === 'Completed' ? (
                <CheckCircle2 color="green" size={20} />
              ) : task.status === 'PendingVerification' ? (
                <FileCheck2 size={20} />
              ) : task.status === 'InProgress' ? (
                <Hourglass size={20} />
              ) : (
                <ClipboardList size={20} />
              )}
              <Typography sx={{ fontWeight: 750, fontSize: 16 }}>{state.title}</Typography>
            </Stack>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
              {state.description}
            </Typography>
          </Box>
          {task.status === 'PendingVerification' ? (
            <Button variant="contained" onClick={onVerify} sx={{ flexShrink: 0 }}>
              Nghiệm thu kết quả
            </Button>
          ) : (
            <Button variant="outlined" onClick={onOpenHistory} sx={{ flexShrink: 0 }}>
              Xem lịch sử
            </Button>
          )}
        </Stack>
      </Box>

      {!task.responsibilityAvailable &&
        task.status !== 'Completed' &&
        task.status !== 'Cancelled' && (
          <Alert severity="warning" variant="outlined">
            Cơ sở chưa có người phụ trách.{' '}
            <Button href="/staff-assignments">Mở phân công cơ sở</Button>
          </Alert>
        )}

      <Box component="section">
        <Typography sx={{ fontWeight: 700, fontSize: 17, mb: 1.25 }}>
          Nội dung và kết quả
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
            gap: 1.5,
          }}
        >
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 2, minWidth: 0 }}>
            <Stack
              direction="row"
              spacing={1}
              useFlexGap
              sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}
            >
              <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Yêu cầu công việc</Typography>
              {task.priority === 'High' && (
                <Chip size="small" variant="outlined" color="warning" label="Ưu tiên cao" />
              )}
            </Stack>
            <Typography
              variant="body2"
              sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', lineHeight: 1.7 }}
            >
              {task.requirements || 'Chưa có mô tả yêu cầu.'}
            </Typography>
          </Box>
          <Box
            sx={{
              border: 1,
              borderColor: task.status === 'Completed' ? 'success.main' : 'divider',
              bgcolor: (theme) =>
                task.status === 'Completed'
                  ? alpha(theme.palette.success.main, 0.06)
                  : 'background.paper',
              borderRadius: 1.5,
              p: 2,
              minWidth: 0,
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.5 }}>
              <ListChecks size={18} />
              <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Kết quả Staff</Typography>
              {submitted && (
                <Chip
                  size="small"
                  variant="outlined"
                  color={task.status === 'Completed' ? 'success' : 'warning'}
                  label={task.status === 'Completed' ? 'Đã nghiệm thu' : 'Chờ nghiệm thu'}
                />
              )}
            </Stack>
            <Typography
              variant="body2"
              sx={{
                whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere',
                lineHeight: 1.7,
                color: task.result ? 'text.primary' : 'text.secondary',
              }}
            >
              {task.result?.trim() || 'Nhân viên chưa gửi nội dung kết quả hoàn thành.'}
            </Typography>
            {task.verifiedAt && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mt: 1.5 }}
              >
                Owner nghiệm thu: {formatInstant(task.verifiedAt)} · {verifiedBy}
              </Typography>
            )}
          </Box>
        </Box>
      </Box>

      {showEvidence && (
        <Box
          component="section"
          sx={{ border: 1, borderColor: 'divider', borderRadius: 1.5, p: 2 }}
        >
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 1.5 }}
          >
            <Typography sx={{ fontSize: 15, fontWeight: 700 }}>Bằng chứng công việc</Typography>
            {evidenceCount > 0 && (
              <Chip size="small" variant="outlined" label={`${evidenceCount} tệp`} />
            )}
          </Stack>
          {task.evidenceRequired && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Công việc yêu cầu bằng chứng khi hoàn thành.
            </Typography>
          )}
          <OwnerFeedback busy={evidenceFetching} error={evidenceError} />
          {evidenceError ? (
            <Button onClick={onRetryEvidence}>Tải lại bằng chứng</Button>
          ) : evidence && showEvidenceGallery ? (
            <TaskEvidenceGallery taskId={task.id} evidence={evidence} />
          ) : null}
        </Box>
      )}
    </Stack>
  );
}
