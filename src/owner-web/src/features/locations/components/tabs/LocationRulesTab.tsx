import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Grid,
  MenuItem,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Clock, Edit2, History, Plus, Sparkles } from 'lucide-react';
import { INITIAL_HOUSE_RULES } from '../../mock/locationConfigMock';
import type {
  HouseRuleItem,
  PolicyCategory,
  PolicyVersionRecord,
} from '../../types/locationConfig';
import { PolicyVersioningDialog } from '../PolicyVersioningDialog';
import { isMockMode } from '../../../../services/config';
import { usePortal } from '../../../../app/PortalProvider';
import { propertyError } from '../../../property-api/propertyApi';
import {
  useLocationConfigurationApi,
  type OperatingPolicyData,
  type SetupDocument,
} from '../../api/locationConfigurationApi';

const CATEGORY_NAMES: Record<string, string> = {
  ACCESS_HOURS: 'Giờ giấc & Ra vào',
  VISITOR_RULES: 'Khách thăm & Qua đêm',
  SHARED_FACILITY: 'Tiện ích chung',
  CLEANING: 'Vệ sinh & Rác thải',
  SECURITY: 'An ninh & Trật tự',
  FIRE_SAFETY: 'An toàn PCCC',
  ASSET_USAGE: 'Bảo quản tài sản',
  DEPOSIT_POLICIES: 'Chính sách tiền cọc',
  OTHER_OPERATIONS: 'Vận hành khác',
};

const toRule = (document: SetupDocument<OperatingPolicyData>): HouseRuleItem => ({
  id: document.id,
  name: document.data.title,
  category: 'OTHER_OPERATIONS',
  content: document.data.content,
  effectiveDate: document.data.effectiveFrom,
  status: document.status === 'Published' ? 'ACTIVE' : 'DRAFT',
  version: `V${document.version}`,
  isAppliedToContracts: document.status === 'Published',
});

export function LocationRulesTab({ locationId }: { locationId: string }) {
  const portal = usePortal();
  const api = useLocationConfigurationApi();
  const queryClient = useQueryClient();
  const [houseRules, setHouseRules] = useState<HouseRuleItem[]>(INITIAL_HOUSE_RULES);
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Policy versioning dialog state
  const [selectedPolicyForVersion, setSelectedPolicyForVersion] = useState<HouseRuleItem | null>(
    null,
  );
  const [isVersionDialogOpen, setIsVersionDialogOpen] = useState(false);

  // Add rule dialog
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newRuleName, setNewRuleName] = useState('');
  const [newRuleCategory, setNewRuleCategory] = useState<PolicyCategory>('ACCESS_HOURS');
  const [newRuleContent, setNewRuleContent] = useState('');
  const [newRuleEffectiveDate, setNewRuleEffectiveDate] = useState('2026-12-01');

  const apiQuery = useQuery({
    queryKey: ['operating-policies', locationId],
    queryFn: ({ signal }) => api.operatingPolicies(locationId, signal),
    enabled: !isMockMode && Boolean(locationId),
  });
  const apiMutation = useMutation({
    mutationFn: (run: () => Promise<unknown>) => run(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['operating-policies', locationId] });
      portal.notify('Đã lưu nội quy vào Backend.');
    },
    onError: (error) => portal.notify(propertyError(error), true),
  });
  const visibleRules = isMockMode ? houseRules : (apiQuery.data ?? []).map(toRule);

  const filteredRules =
    selectedCategory === 'ALL'
      ? visibleRules
      : visibleRules.filter((r) => r.category === selectedCategory);

  const handleOpenVersionDialog = (rule: HouseRuleItem) => {
    setSelectedPolicyForVersion(rule);
    setIsVersionDialogOpen(true);
  };

  const handleSaveNewVersion = (policyId: string, newVersion: PolicyVersionRecord) => {
    if (!isMockMode) {
      const current = visibleRules.find((rule) => rule.id === policyId);
      if (!current) return;
      apiMutation.mutate(async () => {
        const created = await api.createOperatingPolicy({
          locationId,
          title: current.name,
          content: newVersion.value,
          effectiveFrom: newVersion.effectiveDate,
          expectedVersion: 0,
        });
        return newVersion.status === 'ACTIVE'
          ? api.publishOperatingPolicy(created.id, created.version)
          : created;
      });
      return;
    }
    setHouseRules((prev) =>
      prev.map((r) => {
        if (r.id !== policyId) return r;
        const history = r.history || [];
        return {
          ...r,
          version: newVersion.version,
          content: newVersion.value,
          effectiveDate: newVersion.effectiveDate,
          status: newVersion.status === 'SCHEDULED' ? 'SCHEDULED' : 'ACTIVE',
          history: [newVersion, ...history],
        };
      }),
    );
  };

  const handleUpdateDraft = (policyId: string, updatedContent: string) => {
    if (!isMockMode) {
      const current = visibleRules.find((rule) => rule.id === policyId);
      if (!current) return;
      apiMutation.mutate(() =>
        api.updateOperatingPolicy(policyId, {
          locationId,
          title: current.name,
          content: updatedContent,
          effectiveFrom: current.effectiveDate,
          expectedVersion: Number(current.version.replace(/\D/g, '')),
        }),
      );
      return;
    }
    setHouseRules((prev) =>
      prev.map((r) => (r.id === policyId ? { ...r, content: updatedContent } : r)),
    );
  };

  const handleCreateRule = () => {
    if (!newRuleName.trim() || !newRuleContent.trim()) return;
    if (!isMockMode) {
      apiMutation.mutate(
        () =>
          api.createOperatingPolicy({
            locationId,
            title: newRuleName.trim(),
            content: newRuleContent.trim(),
            effectiveFrom: newRuleEffectiveDate,
            expectedVersion: 0,
          }),
        {
          onSuccess: () => {
            setIsAddDialogOpen(false);
            setNewRuleName('');
            setNewRuleContent('');
          },
        },
      );
      return;
    }
    const rule: HouseRuleItem = {
      id: `rule-${Date.now()}`,
      name: newRuleName,
      category: newRuleCategory,
      content: newRuleContent,
      effectiveDate: newRuleEffectiveDate,
      status: 'DRAFT',
      version: 'V1',
      isAppliedToContracts: false,
    };
    setHouseRules((prev) => [rule, ...prev]);
    setIsAddDialogOpen(false);
    setNewRuleName('');
    setNewRuleContent('');
  };

  return (
    <Box>
      {!isMockMode && apiQuery.isPending && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Đang tải nội quy từ Backend...
        </Alert>
      )}
      {!isMockMode && apiQuery.isError && (
        <Alert
          severity="error"
          sx={{ mb: 2 }}
          action={<Button onClick={() => void apiQuery.refetch()}>Thử lại</Button>}
        >
          {propertyError(apiQuery.error)}
        </Alert>
      )}
      {!isMockMode && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Backend hiện quản lý nội quy theo từng cơ sở và chưa lưu trường danh mục. Các nội quy API được hiển thị trong nhóm “Vận hành khác”.
        </Alert>
      )}
      {/* Top Banner explaining Policy Versioning */}
      <Alert
        severity="info"
        icon={<History size={20} />}
        sx={{
          mb: 3,
          borderRadius: 2.5,
          bgcolor: '#eff6ff',
          color: '#1e40af',
          border: '1px solid #bfdbfe',
        }}
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 800 }}>
          Cơ chế kiểm soát phiên bản quy định & Bảo toàn dữ liệu lịch sử
        </Typography>
        <Typography variant="body2">
          Các nội quy đã liên kết với hợp đồng thuê đang hiệu lực (được đánh dấu{' '}
          <strong>Đã áp dụng vào hợp đồng</strong>) sẽ không thể ghi đè trực tiếp. Mọi thay đổi sẽ
          kích hoạt quy trình tạo phiên bản mới (V1 → V2) kèm ngày bắt đầu hiệu lực, đảm bảo tính
          minh bạch và tránh tranh chấp pháp lý.
        </Typography>
      </Alert>

      {/* Filter and Action Bar */}
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 1.5,
          mb: 2.5,
        }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <TextField
            select
            size="small"
            label="Danh mục nội quy"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            sx={{ minWidth: 240 }}
          >
            <MenuItem value="ALL">Tất cả danh mục ({visibleRules.length})</MenuItem>
            <MenuItem value="ACCESS_HOURS">Giờ giấc & Ra vào</MenuItem>
            <MenuItem value="VISITOR_RULES">Khách thăm & Qua đêm</MenuItem>
            <MenuItem value="FIRE_SAFETY">An toàn PCCC</MenuItem>
            <MenuItem value="CLEANING">Vệ sinh & Rác thải</MenuItem>
            <MenuItem value="ASSET_USAGE">Bảo quản tài sản</MenuItem>
            <MenuItem value="DEPOSIT_POLICIES">Chính sách tiền cọc</MenuItem>
          </TextField>
        </Stack>

        <Button
          variant="contained"
          startIcon={<Plus size={16} />}
          onClick={() => setIsAddDialogOpen(true)}
        >
          Thêm quy định mới
        </Button>
      </Stack>

      {/* Rules Grid */}
      <Grid container spacing={2.5}>
        {filteredRules.map((rule) => {
          const isApplied = rule.isAppliedToContracts;

          return (
            <Grid key={rule.id} size={{ xs: 12, md: 6 }}>
              <Paper
                variant="outlined"
                sx={{
                  p: 2.5,
                  borderRadius: 2.5,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  bgcolor: '#ffffff',
                }}
              >
                <Stack
                  direction="row"
                  sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 1.5 }}
                >
                  <Chip
                    size="small"
                    label={CATEGORY_NAMES[rule.category] || rule.category}
                    color="primary"
                    variant="outlined"
                    sx={{ fontWeight: 750, fontSize: 11 }}
                  />
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Chip
                      size="small"
                      label={isApplied ? 'Đã áp dụng vào hợp đồng' : 'Bản nháp'}
                      color={isApplied ? 'warning' : 'default'}
                      sx={{ fontSize: 10, fontWeight: 750 }}
                    />
                    <Chip
                      size="small"
                      label={`Phiên bản ${rule.version}`}
                      sx={{
                        bgcolor: '#ebf2ff',
                        color: 'primary.main',
                        fontWeight: 800,
                      }}
                    />
                  </Stack>
                </Stack>

                <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 1 }}>
                  {rule.name}
                </Typography>

                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{
                    mb: 2,
                    flex: 1,
                    fontSize: 13.5,
                    lineHeight: 1.6,
                    bgcolor: '#f8fafc',
                    p: 1.5,
                    borderRadius: 1.5,
                    border: '1px solid #f1f5f9',
                  }}
                >
                  {rule.content}
                </Typography>

                <Divider sx={{ my: 1.5 }} />

                <Stack
                  direction="row"
                  sx={{ alignItems: 'center', justifyContent: 'space-between' }}
                >
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Clock size={14} color="#64748b" />
                    <Typography variant="caption" color="text.secondary">
                      Hiệu lực: {rule.effectiveDate}
                    </Typography>
                  </Stack>

                  <Button
                    size="small"
                    variant={isApplied ? 'outlined' : 'contained'}
                    startIcon={isApplied ? <Sparkles size={14} /> : <Edit2 size={14} />}
                    onClick={() => handleOpenVersionDialog(rule)}
                  >
                    {isApplied ? 'Tạo phiên bản mới' : 'Chỉnh sửa bản nháp'}
                  </Button>
                </Stack>
              </Paper>
            </Grid>
          );
        })}
      </Grid>

      {/* Policy Versioning Dialog */}
      <PolicyVersioningDialog
        open={isVersionDialogOpen}
        onClose={() => setIsVersionDialogOpen(false)}
        policy={selectedPolicyForVersion}
        onSaveNewVersion={handleSaveNewVersion}
        onUpdateDraft={handleUpdateDraft}
      />

      {/* Add Rule Dialog */}
      <Dialog
        open={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Thêm nội quy & quy định mới</DialogTitle>
        <DialogContent sx={{ py: 2 }}>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                size="small"
                label="Tên quy định"
                value={newRuleName}
                onChange={(e) => setNewRuleName(e.target.value)}
                placeholder="Ví dụ: Quy định sử dụng ban công và phơi đồ"
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                select
                size="small"
                label="Danh mục"
                value={newRuleCategory}
                disabled={!isMockMode}
                onChange={(e) => setNewRuleCategory(e.target.value as PolicyCategory)}
              >
                <MenuItem value="ACCESS_HOURS">Giờ giấc & Ra vào</MenuItem>
                <MenuItem value="VISITOR_RULES">Khách thăm & Qua đêm</MenuItem>
                <MenuItem value="SHARED_FACILITY">Tiện ích chung</MenuItem>
                <MenuItem value="CLEANING">Vệ sinh & Rác thải</MenuItem>
                <MenuItem value="FIRE_SAFETY">An toàn PCCC</MenuItem>
                <MenuItem value="ASSET_USAGE">Bảo quản tài sản</MenuItem>
                <MenuItem value="DEPOSIT_POLICIES">Chính sách tiền cọc</MenuItem>
                <MenuItem value="OTHER_OPERATIONS">Vận hành khác</MenuItem>
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, sm: 6 }}>
              <TextField
                fullWidth
                size="small"
                type="date"
                label="Ngày bắt đầu hiệu lực"
                slotProps={{ inputLabel: { shrink: true } }}
                value={newRuleEffectiveDate}
                onChange={(e) => setNewRuleEffectiveDate(e.target.value)}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                multiline
                rows={4}
                size="small"
                label="Nội dung điều khoản chi tiết"
                value={newRuleContent}
                onChange={(e) => setNewRuleContent(e.target.value)}
                placeholder="Nhập nội dung quy định cụ thể áp dụng cho khách thuê..."
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button variant="outlined" onClick={() => setIsAddDialogOpen(false)}>
            Hủy
          </Button>
          <Button variant="contained" disabled={apiMutation.isPending} onClick={handleCreateRule}>
            Lưu quy định
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
