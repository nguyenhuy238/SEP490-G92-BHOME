import { useId, useState } from 'react';
import {
  Box,
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
  Tooltip,
  Typography,
} from '@mui/material';
import { Copy } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import { ApiError } from '../../../../../packages/client-core/src/api';
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
import {
  configurationDialogContentSx,
  configurationDialogPaperSx,
  configurationFormGridSx,
  formatConfigurationDate,
} from './SharedConfigurationLayout';

const groups: { id: CopyGroup; label: string }[] = [
  { id: 'RoomDefaults', label: 'Giá trị gợi ý khi tạo phòng' },
  { id: 'AssetTemplates', label: 'Gói tài sản (bản nháp)' },
  { id: 'FeePolicies', label: 'Biểu phí có hiệu lực tại ngày đã chọn' },
  { id: 'OperatingPolicies', label: 'Nội quy (bản nháp)' },
];
export function ApiConfigurationCopy({
  sourceLocationId = '',
  compactTrigger = false,
}: {
  sourceLocationId?: string;
  compactTrigger?: boolean;
}) {
  const { session } = useAuth();
  const api = useSharedConfigurationApi();
  const property = usePropertySetupApi();
  const action = useSetupAction();
  const titleId = useId();
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
    sourceLabel: string;
    targetLabel: string;
  } | null>(null);
  const locations = useQuery({
    queryKey: ['property-setup', 'locations-options', session?.userId],
    queryFn: ({ signal }) => property.locationOptions(signal),
    enabled: open && !!session?.roles.includes('Owner'),
  });
  function change(update: Partial<ConfigurationCopy>) {
    setInput((old) => {
      const next = { ...old, ...update };
      if (!next.groups.includes('FeePolicies')) next.effectiveFrom = null;
      return next;
    });
    setPlan(null);
  }
  if (!session?.roles.includes('Owner')) return null;
  const sameLocation =
    !!input.sourceLocationId && input.sourceLocationId === input.targetLocationId;
  const canPreview =
    !action.busy &&
    !locations.isPending &&
    !locations.isError &&
    !!input.sourceLocationId &&
    !!input.targetLocationId &&
    !sameLocation &&
    !!input.groups.length &&
    (!input.groups.includes('FeePolicies') || !!input.effectiveFrom);
  const locationName = (id: string) =>
    locations.data?.find((location) => location.id === id)?.label ?? id;
  function preview() {
    if (!canPreview) return;
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
        sourceLabel: locationName(input.sourceLocationId),
        targetLabel: locationName(input.targetLocationId),
      });
    }, 'Đã nhận bản xem trước từ máy chủ.');
  }
  function confirm() {
    if (!plan?.response.canProceed || action.busy) return;
    action.run(async () => {
      await api.copy(plan.input, plan.key);
      setPlan(null);
    }, 'Máy chủ đã lưu các cấu hình được sao chép.');
  }
  return (
    <>
      {compactTrigger ? (
        <Tooltip title="Sao chép cấu hình cơ sở">
          <Button
            aria-label="Sao chép cấu hình cơ sở"
            onClick={() => setOpen(true)}
            sx={{ minWidth: { xs: 44, sm: 'auto' }, gap: 0.75 }}
          >
            <Copy size={16} aria-hidden="true" />
            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
              Sao chép cấu hình cơ sở
            </Box>
          </Button>
        </Tooltip>
      ) : (
        <Button onClick={() => setOpen(true)}>Sao chép cấu hình cơ sở</Button>
      )}
      {open && (
        <Dialog
          open={open}
          fullWidth
          maxWidth="md"
          aria-labelledby={titleId}
          slotProps={{ paper: { sx: configurationDialogPaperSx } }}
          onClose={action.busy ? undefined : () => setOpen(false)}
        >
          <DialogTitle id={titleId} sx={{ px: { xs: 1.5, sm: 2 }, py: 1.5, typography: 'h2' }}>
            Sao chép cấu hình giữa các cơ sở
          </DialogTitle>
          <DialogContent dividers sx={configurationDialogContentSx}>
            <Stack spacing={1.5}>
              <SetupActionFeedback
                error={action.error}
                notice={
                  !plan && action.notice === 'Đã nhận bản xem trước từ máy chủ.'
                    ? ''
                    : action.notice
                }
              />
              <Typography color="text.secondary">
                Chọn cấu hình cần sao chép. Bản sao tại cơ sở đích được lưu độc lập.
              </Typography>
              {locations.isPending ? (
                <LoadingState />
              ) : locations.isError ? (
                <ErrorState error={locations.error} retry={() => void locations.refetch()} />
              ) : (
                <>
                  <Box sx={configurationFormGridSx}>
                    {(['sourceLocationId', 'targetLocationId'] as const).map((field) => (
                      <TextField
                        key={field}
                        select
                        disabled={action.busy}
                        label={field === 'sourceLocationId' ? 'Cơ sở nguồn' : 'Cơ sở đích'}
                        value={input[field]}
                        error={field === 'targetLocationId' && sameLocation}
                        helperText={
                          field === 'targetLocationId' && sameLocation
                            ? 'Chọn cơ sở khác cơ sở nguồn.'
                            : undefined
                        }
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
                  </Box>
                  <Box
                    component="fieldset"
                    sx={{
                      m: 0,
                      minWidth: 0,
                      border: 0,
                      p: 0,
                      pt: 1.5,
                      borderTop: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Typography component="legend" variant="h2" sx={{ p: 0 }}>
                      Nhóm cấu hình cần sao chép
                    </Typography>
                    <Box sx={{ ...configurationFormGridSx, gap: 0.5 }}>
                      {groups.map((group) => (
                        <FormControlLabel
                          key={group.id}
                          label={group.label}
                          sx={{ m: 0, minHeight: 44, alignItems: 'center' }}
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
                    </Box>
                  </Box>
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
                  {plan && (
                    <ConfigurationChanges plan={plan.response}>
                      <Typography variant="body2">
                        <strong>Cơ sở nguồn:</strong> {plan.sourceLabel}
                      </Typography>
                      <Typography variant="body2">
                        <strong>Cơ sở đích:</strong> {plan.targetLabel}
                      </Typography>
                      <Typography variant="body2">
                        <strong>Nhóm cấu hình:</strong>{' '}
                        {groups
                          .filter((group) => plan.input.groups.includes(group.id))
                          .map((group) => group.label)
                          .join('; ')}
                      </Typography>
                      {plan.input.groups.includes('FeePolicies') && plan.input.effectiveFrom && (
                        <Typography variant="body2">
                          <strong>Hiệu lực biểu phí:</strong>{' '}
                          {formatConfigurationDate(plan.input.effectiveFrom)}
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.secondary">
                        Không sao chép phòng, tài sản thực tế, hợp đồng, hóa đơn hoặc người thuê.
                      </Typography>
                    </ConfigurationChanges>
                  )}
                </>
              )}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ flexWrap: 'wrap' }}>
            <Button disabled={action.busy} onClick={() => setOpen(false)}>
              Đóng
            </Button>
            {!plan && (
              <Button variant="contained" disabled={!canPreview} onClick={preview}>
                Xem trước sao chép
              </Button>
            )}
            {plan && (
              <>
                {(!plan.response.canProceed ||
                  (action.rawError instanceof ApiError && action.rawError.status === 409)) && (
                  <Button disabled={!canPreview} onClick={preview}>
                    Xem trước lại
                  </Button>
                )}
                <Button
                  variant="contained"
                  disabled={action.busy || !plan.response.canProceed}
                  onClick={confirm}
                >
                  Xác nhận sao chép
                </Button>
              </>
            )}
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}
