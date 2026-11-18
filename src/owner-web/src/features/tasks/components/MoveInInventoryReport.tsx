import { useState } from 'react';
import { Link } from 'react-router';
import {
  Alert,
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Box,
  Button,
  Chip,
  Stack,
  Typography,
} from '@mui/material';
import { ChevronDown } from 'lucide-react';
import { OwnerFeedback } from '../../../components/common/OwnerWorkspace';
import { useOwnerQuery } from '../../../hooks/useOwnerWorkspace';
import { formatInstant } from '../../../../../../packages/client-core/src/localization';
import type { TaskEvidence } from '../taskContracts';
import { taskRoot } from '../useOperationalTasksApi';
import { TaskEvidenceGallery } from './TaskEvidenceGallery';

export interface MoveInInventoryItem {
  id: string;
  assetId: string | null;
  name: string;
  expectedQuantity: number;
  actualQuantity: number | null;
  condition: 'Good' | 'Missing' | 'Damaged' | null;
  notes: string | null;
  evidenceIds: string[] | null;
  incidentId: string | null;
}

export interface MoveInInventoryView {
  taskId: string;
  contractId: string;
  roomId: string;
  locationId: string;
  status: string;
  outcome?: string | null;
  version: number;
  dueAt: string | null;
  completedAt: string | null;
  readyForHandover?: boolean;
  items: MoveInInventoryItem[];
}

const conditionText: Record<string, string> = {
  Good: 'Đạt',
  Missing: 'Thiếu',
  Damaged: 'Hư hỏng cần sửa chữa',
};

/** Read-only Owner view: Staff completes inventory directly, without an Owner approval step. */
export function MoveInInventoryReport({
  taskId,
  evidence,
}: {
  taskId: string;
  evidence?: TaskEvidence[];
}) {
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const report = useOwnerQuery<MoveInInventoryView>(
    ['task-move-in-inventory', taskId],
    `${taskRoot}/${taskId}/move-in-inventory`,
  );
  const data = report.data;
  const checked = data?.items.filter((item) => item.condition).length ?? 0;
  const issues =
    data?.items.filter((item) => item.condition === 'Missing' || item.condition === 'Damaged') ??
    [];

  return (
    <Stack spacing={1.5}>
      <Box>
        <Typography variant="h6" sx={{ fontSize: 16, fontWeight: 600 }}>
          Báo cáo kiểm kê trước bàn giao
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
          Nhân viên hoàn thành trực tiếp. Chủ cơ sở chỉ theo dõi kết quả, không cần nghiệm thu.
        </Typography>
      </Box>
      <OwnerFeedback busy={report.isFetching} error={report.error} />
      {!!report.error && (
        <Button onClick={() => void report.refetch()} sx={{ alignSelf: 'flex-start' }}>
          Tải lại kết quả kiểm kê
        </Button>
      )}
      {data && (
        <>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: 'wrap', alignItems: 'center' }}
          >
            <Chip
              variant="outlined"
              size="small"
              label={`${checked}/${data.items.length} loại đã kiểm tra`}
            />
            {data.completedAt && (
              <Chip
                color="success"
                size="small"
                label={`Hoàn thành ${formatInstant(data.completedAt)}`}
              />
            )}
            {issues.length > 0 && (
              <Chip color="warning" size="small" label={`${issues.length} loại có vấn đề`} />
            )}
            {data.completedAt && data.readyForHandover === true && (
              <Chip
                color="success"
                variant="outlined"
                size="small"
                label="Tài sản sẵn sàng bàn giao"
              />
            )}
          </Stack>
          {issues.length > 0 && (
            <Alert severity="warning" variant="outlined">
              Có tài sản thiếu hoặc hư hỏng. Công việc kiểm kê có thể đã hoàn thành, nhưng sự cố cần
              được theo dõi riêng trước khi bàn giao phòng.
            </Alert>
          )}
          {data.items.length === 0 && (
            <Typography sx={{ fontSize: 14, color: 'text.secondary' }}>
              Phòng chưa có tài sản trong danh sách kiểm kê.
            </Typography>
          )}
          {data.items.map((item) => {
            const photos = evidence?.filter((photo) => item.evidenceIds?.includes(photo.id)) ?? [];
            const hasIssue = item.condition === 'Missing' || item.condition === 'Damaged';
            return (
              <Accordion
                key={item.id}
                expanded={expandedItem === item.id}
                onChange={(_, expanded) => setExpandedItem(expanded ? item.id : null)}
                variant="outlined"
                disableGutters
                sx={{ '&:before': { display: 'none' } }}
              >
                <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                  <Stack spacing={0.5} sx={{ minWidth: 0, width: '100%' }}>
                    <Stack
                      direction="row"
                      spacing={1}
                      useFlexGap
                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                    >
                      <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{item.name}</Typography>
                      <Chip
                        size="small"
                        variant="outlined"
                        color={
                          hasIssue ? 'error' : item.condition === 'Good' ? 'success' : 'default'
                        }
                        label={conditionText[item.condition ?? ''] ?? 'Chưa kiểm tra'}
                      />
                    </Stack>
                    <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                      Dự kiến: {item.expectedQuantity} · Thực tế:{' '}
                      {item.actualQuantity ?? 'Chưa ghi nhận'}
                    </Typography>
                  </Stack>
                </AccordionSummary>
                <AccordionDetails>
                  <Stack spacing={1.5}>
                    <Typography sx={{ fontSize: 14, whiteSpace: 'pre-wrap' }}>
                      {item.notes?.trim() || 'Không có ghi chú.'}
                    </Typography>
                    {item.incidentId && (
                      <Button
                        component={Link}
                        to={`/incidents?locationId=${encodeURIComponent(data.locationId)}&incidentId=${encodeURIComponent(item.incidentId)}`}
                        variant="outlined"
                        sx={{ alignSelf: 'flex-start' }}
                      >
                        Xem báo cáo sự cố BF-07
                      </Button>
                    )}
                    {hasIssue && !item.incidentId && (
                      <Alert severity="warning">Chưa có báo cáo sự cố liên kết.</Alert>
                    )}
                    <Box>
                      <Typography sx={{ fontWeight: 600, fontSize: 13, mb: 1 }}>
                        Ảnh bằng chứng
                      </Typography>
                      {evidence && expandedItem === item.id ? (
                        <TaskEvidenceGallery taskId={taskId} evidence={photos} />
                      ) : !evidence ? (
                        <Typography sx={{ fontSize: 13, color: 'text.secondary' }}>
                          Đang tải ảnh bằng chứng…
                        </Typography>
                      ) : null}
                    </Box>
                  </Stack>
                </AccordionDetails>
              </Accordion>
            );
          })}
        </>
      )}
    </Stack>
  );
}
