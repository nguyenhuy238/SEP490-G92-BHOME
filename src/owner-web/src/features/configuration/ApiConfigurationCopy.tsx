import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import type {
  ConfigurationCopy,
  ConfigurationCopyPlan,
  CopyGroup,
} from '../../../../../packages/client-core/src/sharedConfiguration';
import { ErrorState, LoadingState } from '../../components/common/PortalUI';
import { usePropertySetupApi } from '../property/usePropertySetupApi';
import { SetupActionFeedback } from '../property/UtilityFormTools';
import { useSetupAction } from '../property/useSetupAction';
import { ConfigurationChanges } from './pages/SharedTemplateDetails';
import { useSharedConfigurationApi } from './useSharedConfigurationApi';

const groups: { id: CopyGroup; label: string }[] = [
  { id: 'RoomDefaults', label: 'Giá trị gợi ý khi tạo phòng' },
  { id: 'AssetTemplates', label: 'Gói tài sản (bản nháp)' },
  { id: 'FeePolicies', label: 'Biểu phí có hiệu lực tại ngày đã chọn' },
  { id: 'OperatingPolicies', label: 'Nội quy (bản nháp)' },
];
export function ApiConfigurationCopy({ sourceLocationId = '' }: { sourceLocationId?: string }) {
  const { session } = useAuth();
  const api = useSharedConfigurationApi();
  const property = usePropertySetupApi();
  const action = useSetupAction();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState<ConfigurationCopy>({
    sourceLocationId,
    targetLocationId: '',
    groups: [],
    effectiveFrom: null,
    conflictStrategy: 'Reject',
    sourceState: '',
    targetState: '',
  });
  const [plan, setPlan] = useState<{
    response: ConfigurationCopyPlan;
    input: ConfigurationCopy;
    key: string;
  } | null>(null);
  const locations = useQuery({
    queryKey: ['property-setup', 'locations-options', session?.userId],
    queryFn: ({ signal }) => property.locationOptions(signal),
    enabled: open && !!session?.roles.includes('Owner'),
  });
  function change(update: Partial<ConfigurationCopy>) {
    setInput((old) => ({ ...old, ...update }));
    setPlan(null);
  }
  if (!session?.roles.includes('Owner')) return null;
  return (
    <>
      <Button onClick={() => setOpen(true)}>Sao chép cấu hình cơ sở</Button>
      {open && (
        <Dialog
          open={open}
          fullWidth
          maxWidth="md"
          onClose={action.busy ? undefined : () => setOpen(false)}
        >
          <DialogTitle>Sao chép cấu hình giữa các cơ sở</DialogTitle>
          <DialogContent>
            <Stack spacing={2}>
              <SetupActionFeedback error={action.error} notice={action.notice} />
              <Alert severity="info">
                Chọn nhóm cấu hình, kiểm tra bản xem trước rồi xác nhận. Mỗi bản sao được lưu độc
                lập tại cơ sở đích.
              </Alert>
              {locations.isPending ? (
                <LoadingState />
              ) : locations.isError ? (
                <ErrorState error={locations.error} retry={() => void locations.refetch()} />
              ) : (
                <>
                  {(['sourceLocationId', 'targetLocationId'] as const).map((field) => (
                    <TextField
                      key={field}
                      select
                      disabled={action.busy}
                      label={field === 'sourceLocationId' ? 'Cơ sở nguồn' : 'Cơ sở đích'}
                      value={input[field]}
                      onChange={(e) => change({ [field]: e.target.value })}
                    >
                      <MenuItem value="">Chọn</MenuItem>
                      {locations.data?.map((l) => (
                        <MenuItem key={l.id} value={l.id}>
                          {l.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  ))}
                  <Typography>Nhóm cấu hình cần sao chép</Typography>
                  {groups.map((group) => (
                    <FormControlLabel
                      key={group.id}
                      label={group.label}
                      control={
                        <Checkbox
                          disabled={action.busy}
                          checked={input.groups.includes(group.id)}
                          onChange={(e) =>
                            change({
                              groups: e.target.checked
                                ? [...input.groups, group.id]
                                : input.groups.filter((g) => g !== group.id),
                            })
                          }
                        />
                      }
                    />
                  ))}
                  {input.groups.includes('FeePolicies') && (
                    <TextField
                      required
                      disabled={action.busy}
                      type="date"
                      label="Ngày bắt đầu biểu phí tại cơ sở đích"
                      slotProps={{ inputLabel: { shrink: true } }}
                      value={input.effectiveFrom ?? ''}
                      onChange={(e) => change({ effectiveFrom: e.target.value || null })}
                    />
                  )}
                  <Button
                    disabled={
                      action.busy ||
                      !input.sourceLocationId ||
                      !input.targetLocationId ||
                      !input.groups.length ||
                      (input.groups.includes('FeePolicies') && !input.effectiveFrom)
                    }
                    onClick={() =>
                      action.run(async () => {
                        const response = await api.copyPreview(input);
                        setPlan({
                          response,
                          input: {
                            ...input,
                            sourceState: response.sourceState,
                            targetState: response.targetState,
                          },
                          key: crypto.randomUUID(),
                        });
                      }, 'Đã nhận bản xem trước từ máy chủ.')
                    }
                  >
                    Xem trước sao chép
                  </Button>
                  {plan && (
                    <>
                      <ConfigurationChanges plan={plan.response} />
                      <Button
                        variant="contained"
                        disabled={action.busy || !plan.response.canProceed}
                        onClick={() =>
                          action.run(async () => {
                            await api.copy(plan.input, plan.key);
                            setPlan(null);
                          }, 'Máy chủ đã lưu các cấu hình được sao chép.')
                        }
                      >
                        Xác nhận sao chép
                      </Button>
                    </>
                  )}
                </>
              )}
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button disabled={action.busy} onClick={() => setOpen(false)}>
              Đóng
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
