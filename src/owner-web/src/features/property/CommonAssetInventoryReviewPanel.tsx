import { ValidatedInput } from '../../components/common/ValidatedForm';
import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../../../packages/client-core/src/auth';
import type {
  CommonAssetInventoryConfirmation,
  CommonAssetInventoryItem,
  RoomInventoryReviewEvidence,
} from '../../../../../packages/client-core/src/propertySetup';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { invoiceError } from '../../../../../packages/client-core/src/invoices';
import { ErrorState, LoadingState } from '../../components/common/PortalUI';
import { ConflictReload } from '../locations/components/ConflictReload';
import { usePropertySetupApi } from './usePropertySetupApi';
import { MoneyField } from '../../components/common/MoneyField';

type Evidence = RoomInventoryReviewEvidence & { fileName?: string };
type DraftItem = Omit<CommonAssetInventoryItem, 'evidence'> & {
  evidence: Evidence[];
  unitCost: string;
  uploading: boolean;
  error: string;
};
const defaultUnitCost = (item: CommonAssetInventoryItem): string => {
  const value = item.acquisitionUnitCost ?? item.referenceUnitCost;
  const raw = value == null ? '' : String(value);
  return /^\d{1,14}$/.test(raw) ? raw : '';
};
const validUnitCost = (value: string) =>
  value === '' || (/^\d{1,14}$/.test(value) && Number(value) <= 99_999_999_999_999);
const unitCostHint = (item: CommonAssetInventoryItem): string =>
  item.acquisitionUnitCost != null
    ? 'Đã chốt giá vốn'
    : item.referenceUnitCost != null && defaultUnitCost(item) === ''
      ? 'Giá mẫu không phải số nguyên VND; vui lòng nhập đơn giá mua.'
      : item.referenceUnitCost != null
        ? 'Gợi ý từ mẫu'
        : 'Chưa có giá tham khảo';
type ReviewDialog = {
  requestId: string;
  mode: 'review' | 'bulk';
  attested: boolean;
  items: DraftItem[];
};

const statusLabels = {
  NotChecked: { label: 'Chưa kiểm kê', color: 'default' },
  PartiallyChecked: { label: 'Kiểm kê chưa đủ', color: 'error' },
  Matched: { label: 'Đã kiểm kê đủ', color: 'success' },
  NeedsReview: { label: 'Cần đối chiếu', color: 'warning' },
} as const;

export function CommonAssetInventoryReviewPanel({ locationId }: { locationId: string }) {
  const api = usePropertySetupApi();
  const { session } = useAuth();
  const owner = session?.roles.includes('Owner') ?? false;
  const queryKey = ['property-setup', 'common-asset-inventory-review', session?.userId, locationId];
  const cache = useQueryClient();
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.commonAssetInventoryReview(locationId, signal),
    enabled: owner,
  });
  const [dialog, setDialog] = useState<ReviewDialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [rawError, setRawError] = useState<unknown>(null);

  if (!owner) return <Alert severity="info">Chỉ Owner được xác nhận kiểm kê tài sản chung.</Alert>;
  if (query.isPending) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;

  const review = query.data;
  const status = statusLabels[review.state] ?? statusLabels.NeedsReview;
  const canReview = !!review.requirementsId && review.items.length > 0;

  const openReview = (mode: ReviewDialog['mode']) => {
    setError('');
    setRawError(null);
    setDialog({
      requestId: crypto.randomUUID(),
      mode,
      attested: false,
      items: review.items.map((item) => ({
        ...item,
        checked: mode === 'bulk' && !item.blockedReason ? true : item.checked,
        unitCost: defaultUnitCost(item),
        evidence: item.evidence.map((photo) => ({ ...photo })),
        uploading: false,
        error: '',
      })),
    });
  };
  const updateItem = (itemId: string, patch: Partial<DraftItem>) => {
    setDialog((previous) =>
      previous
        ? {
            ...previous,
            requestId: crypto.randomUUID(),
            items: previous.items.map((item) =>
              item.id === itemId ? { ...item, ...patch } : item,
            ),
          }
        : previous,
    );
  };

  const upload = async (itemId: string, filesInput: FileList | File[]) => {
    const selected = dialog?.items.find((item) => item.id === itemId);
    const files = Array.from(filesInput);
    if (!selected?.checked || !files.length) return;
    if (
      files.some(
        (file) => !['image/png', 'image/jpeg'].includes(file.type) || file.size > 5 * 1024 * 1024,
      )
    ) {
      updateItem(itemId, { error: 'Chỉ nhận ảnh JPEG hoặc PNG, mỗi ảnh tối đa 5 MB.' });
      return;
    }
    if (selected.evidence.length + files.length > 5) {
      updateItem(itemId, { error: 'Mỗi nhóm tài sản chỉ được đính kèm tối đa 5 ảnh.' });
      return;
    }
    updateItem(itemId, { uploading: true, error: '' });
    const results = await Promise.allSettled(
      files.map(async (file) => {
        const result = await api.uploadEvidence(locationId, file);
        return {
          id: result.evidenceId,
          contentType: file.type,
          uploadedAt: new Date().toISOString(),
          uploadedBy: null,
          fileName: file.name,
        } satisfies Evidence;
      }),
    );
    const uploaded = results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );
    const failed = results.find((result) => result.status === 'rejected');
    setDialog((previous) =>
      previous
        ? {
            ...previous,
            requestId: crypto.randomUUID(),
            items: previous.items.map((item) =>
              item.id === itemId
                ? {
                    ...item,
                    evidence: [...item.evidence, ...uploaded],
                    uploading: false,
                    error: failed?.status === 'rejected' ? invoiceError(failed.reason) : '',
                  }
                : item,
            ),
          }
        : previous,
    );
  };

  const canSubmit =
    !!dialog &&
    dialog.attested &&
    !busy &&
    dialog.items.every(
      (item) =>
        !item.uploading &&
        item.evidence.length <= 5 &&
        (!item.checked || (!item.blockedReason && validUnitCost(item.unitCost))),
    );

  const confirm = async () => {
    if (!dialog || !canSubmit || !review.requirementsId) return;
    const input: CommonAssetInventoryConfirmation = {
      requestId: dialog.requestId,
      requirementsId: review.requirementsId,
      requirementsVersion: review.requirementsVersion,
      stateToken: review.stateToken,
      confirmed: true,
      items: dialog.items.map((item) => ({
        itemId: item.id,
        checked: item.checked,
        evidenceIds: item.checked ? item.evidence.map((photo) => photo.id) : [],
        unitCost: item.checked && item.unitCost !== '' ? item.unitCost : null,
      })),
    };
    setBusy(true);
    setError('');
    setRawError(null);
    try {
      const updated = await api.confirmCommonAssetInventory(locationId, input);
      cache.setQueryData(queryKey, updated);
      void cache.invalidateQueries({
        queryKey: ['property-setup', 'assets', session?.userId, locationId],
      });
      void cache.invalidateQueries({
        queryKey: ['location-finance', 'capital-assets', session?.userId, locationId],
      });
      void cache.invalidateQueries({
        queryKey: ['location-finance', 'report', session?.userId, locationId],
      });
      void cache.invalidateQueries({
        queryKey: ['location-finance', 'capital-report', session?.userId, locationId],
      });
      void cache.invalidateQueries({ queryKey: ['financial-report', session?.userId] });
      void cache.invalidateQueries({ queryKey: ['expenses', session?.userId] });
      setDialog(null);
      setNotice('Đã lưu kiểm kê tài sản chung của cơ sở.');
    } catch (cause) {
      setError(invoiceError(cause));
      setRawError(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        sx={{ justifyContent: 'space-between', alignItems: { md: 'center' }, gap: 1 }}
      >
        <Box>
          <Typography component="h3" variant="subtitle1" sx={{ fontWeight: 700 }}>
            Tài sản khu vực chung
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Kiểm tra từng nhóm tài sản thực tế theo khu vực đã cấu hình.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <Button
            variant="outlined"
            disabled={!canReview || busy}
            onClick={() => openReview('review')}
          >
            Kiểm tra từng tài sản
          </Button>
          <Button
            variant="contained"
            disabled={
              !canReview ||
              busy ||
              review.items.every((item) => item.checked || item.blockedReason !== null)
            }
            onClick={() => openReview('bulk')}
          >
            Kiểm kê nhanh tài sản chung
          </Button>
        </Stack>
      </Stack>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={1}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              {review.checkedCount}/{review.totalCount} nhóm tài sản đã kiểm kê đủ
            </Typography>
            <Chip size="small" label={status.label} color={status.color} />
          </Stack>
          <LinearProgress
            variant="determinate"
            value={review.totalCount ? (review.checkedCount / review.totalCount) * 100 : 0}
            aria-label="Tiến độ kiểm kê tài sản chung"
          />
          {review.reviewedAt && (
            <Typography variant="caption" color="text.secondary">
              Lần kiểm kê: {formatInstant(review.reviewedAt)}
            </Typography>
          )}
        </Stack>
      </Paper>
      {notice && <Alert severity="success">{notice}</Alert>}
      {error && !dialog && <Alert severity="error">{error}</Alert>}
      <TableContainer component={Paper} variant="outlined">
        <Table
          size="small"
          aria-label="Danh sách kiểm kê tài sản khu vực chung"
          sx={{ minWidth: 600 }}
        >
          <TableHead>
            <TableRow>
              <TableCell>Tài sản</TableCell>
              <TableCell>Khu vực</TableCell>
              <TableCell align="right">Theo thiết lập</TableCell>
              <TableCell>Đã kiểm kê</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {review.items.map((item) => (
              <TableRow key={item.id} hover>
                <TableCell sx={{ fontWeight: 600 }}>{item.name}</TableCell>
                <TableCell>{item.commonArea}</TableCell>
                <TableCell align="right">
                  {item.quantity} {item.unit ?? ''}
                </TableCell>
                <TableCell>
                  <Chip
                    size="small"
                    color={item.blockedReason ? 'warning' : item.checked ? 'success' : 'error'}
                    label={
                      item.blockedReason
                        ? 'Cần đối chiếu'
                        : item.checked
                          ? 'Đã kiểm kê đủ'
                          : 'Chưa kiểm kê đủ'
                    }
                  />
                </TableCell>
              </TableRow>
            ))}
            {!review.items.length && (
              <TableRow>
                <TableCell colSpan={4} sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
                  Chưa có tài sản chung được cấu hình. Hãy thêm tài sản tại tab “Tài sản chung cơ
                  sở”.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {dialog && (
        <Dialog
          open
          fullWidth
          maxWidth="lg"
          aria-labelledby="common-review-title"
          onClose={busy ? undefined : () => setDialog(null)}
        >
          <DialogTitle id="common-review-title">
            {dialog.mode === 'bulk'
              ? 'Kiểm kê nhanh tài sản chung'
              : 'Kiểm kê tài sản khu vực chung'}
          </DialogTitle>
          <DialogContent dividers>
            <Stack spacing={2}>
              {dialog.mode === 'bulk' && (
                <Alert severity="info">
                  Chỉ xác nhận toàn bộ nhóm được đánh dấu khi đã kiểm tra thực tế. Nhóm có chênh
                  lệch sẽ giữ trạng thái chưa đủ.
                </Alert>
              )}
              <Typography variant="body2" color="text.secondary">
                Đơn giá mua mặc định từ giá tham khảo của mẫu, có thể sửa khi kiểm kê. Để trống khi
                chưa biết giá; giá vốn đã ghi nhận trước đó sẽ không bị ghi đè.
              </Typography>
              <TableContainer>
                <Table size="small" aria-label="Xác nhận tài sản chung" sx={{ minWidth: 620 }}>
                  <TableHead>
                    <TableRow>
                      <TableCell>Tài sản / Khu vực</TableCell>
                      <TableCell align="right">Theo thiết lập</TableCell>
                      <TableCell>Đã kiểm tra</TableCell>
                      <TableCell>Đơn giá mua (VNĐ)</TableCell>
                      <TableCell>Ảnh bằng chứng</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {dialog.items.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {item.name}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {item.commonArea}
                          </Typography>
                        </TableCell>
                        <TableCell align="right">
                          {item.quantity} {item.unit ?? ''}
                        </TableCell>
                        <TableCell>
                          <FormControlLabel
                            control={
                              <Checkbox
                                checked={item.checked}
                                disabled={busy || item.uploading || !!item.blockedReason}
                                onChange={(_, checked) =>
                                  updateItem(item.id, { checked, error: '' })
                                }
                              />
                            }
                            label="Đã kiểm tra và đủ"
                          />
                          {item.blockedReason && (
                            <Typography variant="caption" color="error">
                              Tài sản thực tế đang khác cấu hình hoặc có nhiều bản ghi trùng.
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell>
                          <MoneyField
                            size="small"
                            label={`Đơn giá mua (VNĐ) · ${item.name}`}
                            value={item.unitCost}
                            disabled={busy || !item.checked || item.acquisitionUnitCost != null}
                            error={!validUnitCost(item.unitCost)}
                            helperText={unitCostHint(item)}
                            onValueChange={(unitCost) => updateItem(item.id, { unitCost })}
                          />
                        </TableCell>
                        <TableCell>
                          <Stack spacing={0.5}>
                            <Button
                              component="label"
                              size="small"
                              variant="outlined"
                              disabled={
                                busy || item.uploading || !item.checked || item.evidence.length >= 5
                              }
                            >
                              {item.uploading
                                ? 'Đang tải ảnh…'
                                : item.evidence.length
                                  ? 'Thêm ảnh'
                                  : 'Chụp / tải ảnh'}
                              <ValidatedInput
                                hidden
                                type="file"
                                accept="image/png,image/jpeg"
                                capture="environment"
                                multiple
                                aria-label={`Ảnh bằng chứng ${item.name}`}
                                disabled={!item.checked || busy}
                                onChange={(event) => {
                                  if (event.target.files) void upload(item.id, event.target.files);
                                  event.target.value = '';
                                }}
                              />
                            </Button>
                            <Typography variant="caption" color="text.secondary">
                              Ảnh tùy chọn, tối đa 5 ảnh
                            </Typography>
                            <Stack
                              direction="row"
                              spacing={0.5}
                              useFlexGap
                              sx={{ flexWrap: 'wrap' }}
                            >
                              {item.evidence.map((photo, index) => (
                                <Chip
                                  key={photo.id}
                                  size="small"
                                  variant="outlined"
                                  label={photo.fileName ?? `Ảnh ${index + 1}`}
                                  onDelete={
                                    busy || item.uploading
                                      ? undefined
                                      : () =>
                                          updateItem(item.id, {
                                            evidence: item.evidence.filter(
                                              (saved) => saved.id !== photo.id,
                                            ),
                                          })
                                  }
                                />
                              ))}
                            </Stack>
                            {item.error && (
                              <Typography variant="caption" color="error">
                                {item.error}
                              </Typography>
                            )}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={dialog.attested}
                    disabled={busy}
                    onChange={(_, attested) =>
                      setDialog((previous) =>
                        previous
                          ? {
                              ...previous,
                              requestId: crypto.randomUUID(),
                              attested,
                            }
                          : null,
                      )
                    }
                  />
                }
                label="Tôi đã trực tiếp kiểm tra và xác nhận các nhóm tài sản được đánh dấu là đầy đủ."
              />
              {error && <Alert severity="error">{error}</Alert>}
              <ConflictReload
                error={rawError}
                reload={async () => {
                  await query.refetch({ throwOnError: true });
                  setDialog(null);
                  setRawError(null);
                  setError('');
                }}
              />
            </Stack>
          </DialogContent>
          <DialogActions>
            <Button disabled={busy} onClick={() => setDialog(null)}>
              Hủy
            </Button>
            <Button variant="contained" disabled={!canSubmit} onClick={() => void confirm()}>
              {busy ? 'Đang lưu…' : 'Xác nhận kiểm kê'}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </Stack>
  );
}
