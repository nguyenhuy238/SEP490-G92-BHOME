import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Accordion,
  AccordionDetails,
  AccordionSummary,
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  MenuItem,
  Paper,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ChevronDown, Plus } from 'lucide-react';
import { useAuth } from '../../../../../../packages/client-core/src/auth';
import {
  financeError,
  formatFinanceMoney,
  type Expense,
  type ExpenseInput,
  type ExpensePage,
} from '../../../../../../packages/client-core/src/finance';
import { MoneyField } from '../../../components/common/MoneyField';
import { todayVietnam } from '../../staff/staffContracts';
import { useFinanceApi } from '../../expenses/useFinanceApi';
import { usePropertySetupApi } from '../../property/usePropertySetupApi';

type FinanceSection = 'overview' | 'assets' | 'initial' | 'expenses' | 'recurring';
type EntryMode = 'total' | 'detail';
type EntryRow = { id: number; name: string; amount: string };
type AssetCapitalItem = {
  id: string;
  name: string;
  quantity: number;
  unitCost: string | null;
  totalCost: string | null;
};
type AssetCapitalGroup = {
  id: string;
  name: string;
  scope: 'room' | 'common';
  verified: boolean;
  knownTotal: string;
  assets: AssetCapitalItem[];
};
type CapitalAssets = {
  knownTotal: string;
  roomsTotal: string;
  commonTotal: string;
  unpricedCount: number;
  unreviewedRoomCount: number;
  unreviewedCommonCount: number;
  groups: AssetCapitalGroup[];
};
type RecurringExpenseRule = {
  id: string;
  locationId: string;
  name: string;
  amount: string;
  frequency: 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  dayOfMonth: number;
  startsOn: string;
  endsOn: string | null;
  active: boolean;
  version: number;
  effectiveFrom: string;
};
type RecurringExpenseWrite = Omit<RecurringExpenseRule, 'id' | 'version'> & {
  expectedVersion: number;
};
type RecurringForm = {
  existing?: RecurringExpenseRule;
  name: string;
  amount: string;
  frequency: RecurringExpenseRule['frequency'];
  startsOn: string;
  endsOn: string;
  active: boolean;
  effectiveFrom: string;
};
const recurringFrequency: Record<RecurringExpenseRule['frequency'], string> = {
  MONTHLY: 'Hằng tháng',
  QUARTERLY: 'Hằng quý',
  YEARLY: 'Hằng năm',
};
const sections: { id: FinanceSection; label: string }[] = [
  { id: 'overview', label: 'Tổng quan' },
  { id: 'assets', label: 'Vốn tài sản' },
  { id: 'initial', label: 'Đầu tư khác' },
  { id: 'expenses', label: 'Chi phí phát sinh' },
  { id: 'recurring', label: 'Chi phí định kỳ' },
];

function Amount({ value }: { value: string | null | undefined }) {
  return <>{value == null ? '—' : formatFinanceMoney(value)}</>;
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ px: 3, py: 4, textAlign: 'center' }}>
      <Typography color="text.secondary">{children}</Typography>
    </Paper>
  );
}
function Metric({ title, value, description }: { title: string; value: string | null | undefined; description?: string }) {
  return (
    <Paper variant="outlined" sx={{ flex: '1 1 180px', p: 2, minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary">{title}</Typography>
      <Typography variant="h6" sx={{ fontWeight: 750, fontVariantNumeric: 'tabular-nums' }}>
        <Amount value={value} />
      </Typography>
      {description && <Typography variant="caption" color="text.secondary">{description}</Typography>}
    </Paper>
  );
}
function nextMonthStart(day: string) {
  const [year, month] = day.split('-').map(Number);
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}
// The capital forecast needs a complete-month window, not the current month.
function recoveryBaseline(today: string) {
  const [year, month] = today.split('-').map(Number);
  return {
    from: new Date(Date.UTC(year, month - 7, 1)).toISOString().slice(0, 10),
    to: new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10),
  };
}

function ExpenseList({ records, title, onView }: { records: Expense[]; title: string; onView: (expense: Expense) => void }) {
  if (!records.length) return <Empty>Chưa có {title.toLowerCase()} được ghi nhận cho cơ sở.</Empty>;
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" sx={{ '& td, & th': { borderRight: '1px solid', borderRightColor: 'divider' } }}>
        <TableHead>
          <TableRow>
            <TableCell>Hạng mục</TableCell>
            <TableCell>Ngày phát sinh</TableCell>
            <TableCell>Nguồn</TableCell>
            <TableCell align="right">Số tiền</TableCell>
            <TableCell align="right">Thao tác</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {records.map((record) => (
            <TableRow key={record.id}>
              <TableCell>{record.category}</TableCell>
              <TableCell>{record.occurredOn.split('-').reverse().join('/')}</TableCell>
              <TableCell>{record.canEdit ? 'Owner' : 'Nghiệp vụ nguồn'}</TableCell>
              <TableCell align="right"><Amount value={record.amount} /></TableCell>
              <TableCell align="right">
                <Button size="small" onClick={() => onView(record)}>Chi tiết</Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

export function LocationFinanceWorkspace() {
  const { locationId = '' } = useParams();
  const { session } = useAuth();
  const owner = session?.roles.includes('Owner') ?? false;
  const api = useFinanceApi();
  const propertyApi = usePropertySetupApi();
  const client = useQueryClient();
  const [section, setSection] = useState<FinanceSection>('overview');
  const [entryMode, setEntryMode] = useState<EntryMode>('total');
  const [dialog, setDialog] = useState<'initial' | 'expenses' | null>(null);
  const [inspect, setInspect] = useState<Expense | null>(null);
  const [recurringForm, setRecurringForm] = useState<RecurringForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [occurredOn, setOccurredOn] = useState(todayVietnam());
  const [note, setNote] = useState('');
  const [rows, setRows] = useState<EntryRow[]>([{ id: 1, name: '', amount: '' }]);
  const [capitalScope, setCapitalScope] = useState<'room' | 'common'>('room');
  const [expensePage, setExpensePage] = useState(1);
  const mutationKey = useRef(crypto.randomUUID());
  const today = todayVietnam();
  const baseline = recoveryBaseline(today);
  const firstOfMonth = `${today.slice(0, 7)}-01`;

  const report = useQuery({
    queryKey: ['location-finance', 'report', session?.userId, locationId, firstOfMonth, today],
    queryFn: ({ signal }) => api.report({ locationId, from: firstOfMonth, to: today }, signal),
    enabled: !!locationId && owner,
  });
  const capitalReport = useQuery({
    queryKey: ['location-finance', 'capital-report', session?.userId, locationId, baseline.from, baseline.to],
    queryFn: ({ signal }) => api.report({ locationId, from: baseline.from, to: baseline.to }, signal),
    enabled: !!locationId && owner && section === 'overview',
  });
  const capitalAssets = useQuery({
    queryKey: ['location-finance', 'capital-assets', session?.userId, locationId],
    queryFn: ({ signal }) =>
      propertyApi.request<CapitalAssets>(
        `/api/v1/locations/${encodeURIComponent(locationId)}/capital-assets`,
        { signal },
      ),
    enabled: !!locationId && owner && (section === 'overview' || section === 'assets'),
  });
  const recurring = useQuery({
    queryKey: ['location-finance', 'recurring', session?.userId, locationId],
    queryFn: ({ signal }) =>
      propertyApi.request<RecurringExpenseRule[]>(
        `/api/v1/recurring-expenses?locationId=${encodeURIComponent(locationId)}`,
        { signal },
      ),
    enabled: !!locationId && owner && section === 'recurring',
  });
  const expenses = useQuery({
    queryKey: ['location-finance', 'expenses', session?.userId, locationId, section, expensePage],
    queryFn: ({ signal }) =>
      section === 'initial'
        ? propertyApi.request<ExpensePage>(
            `/api/v1/location-investments?locationId=${encodeURIComponent(locationId)}&page=${expensePage}`,
            { signal },
          )
        : api.expenses({
            locationId,
            expenseType: 'OPERATING',
            page: expensePage,
          }, signal),
    enabled: !!locationId && owner && (section === 'initial' || section === 'expenses'),
  });
  const allVisibleExpenses = useMemo(() => expenses.data?.items ?? [], [expenses.data?.items]);

  function openCreate(kind: 'initial' | 'expenses') {
    setError('');
    setNotice('');
    setCategory('');
    setAmount('');
    setNote('');
    setOccurredOn(todayVietnam());
    setEntryMode('total');
    setRows([{ id: 1, name: '', amount: '' }]);
    mutationKey.current = crypto.randomUUID();
    setDialog(kind);
  }

  function openRecurring(existing?: RecurringExpenseRule) {
    setError('');
    setNotice('');
    mutationKey.current = crypto.randomUUID();
    setRecurringForm({
      existing,
      name: existing?.name ?? '',
      amount: existing?.amount ?? '',
      frequency: existing?.frequency ?? 'MONTHLY',
      startsOn: existing?.startsOn ?? todayVietnam(),
      endsOn: existing?.endsOn ?? '',
      active: existing?.active ?? true,
      effectiveFrom: existing
        ? [nextMonthStart(todayVietnam()), nextMonthStart(existing.effectiveFrom)].sort().at(-1)!
        : todayVietnam(),
    });
  }

  async function saveRecurring() {
    if (!recurringForm || busy) return;
    const parsed = Number(recurringForm.amount);
    if (!recurringForm.name.trim() || !Number.isSafeInteger(parsed) || parsed <= 0 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(recurringForm.startsOn) ||
      (recurringForm.endsOn !== '' && recurringForm.endsOn < recurringForm.startsOn) ||
      (recurringForm.existing && recurringForm.effectiveFrom < todayVietnam())) {
      setError('Quy tắc chưa hợp lệ. Kiểm tra số tiền, ngày, chu kỳ và ngày hiệu lực.');
      return;
    }
    const body: RecurringExpenseWrite = {
      locationId,
      name: recurringForm.name.trim(),
      amount: recurringForm.amount,
      frequency: recurringForm.frequency,
      // New rules use the chosen start date as the only due-day anchor.
      // Preserve a legacy rule's due day on edit to avoid silently rewriting
      // charges that were already generated under its prior schedule.
      dayOfMonth: recurringForm.existing?.dayOfMonth ?? Number(recurringForm.startsOn.slice(8, 10)),
      startsOn: recurringForm.startsOn,
      endsOn: recurringForm.endsOn || null,
      active: recurringForm.active,
      expectedVersion: recurringForm.existing?.version ?? 0,
      effectiveFrom: recurringForm.existing ? recurringForm.effectiveFrom : recurringForm.startsOn,
    };
    setBusy(true);
    setError('');
    try {
      await propertyApi.request<RecurringExpenseRule>(
        recurringForm.existing
          ? `/api/v1/recurring-expenses/${encodeURIComponent(recurringForm.existing.id)}`
          : '/api/v1/recurring-expenses',
        {
          method: recurringForm.existing ? 'PUT' : 'POST',
          headers: { 'Idempotency-Key': mutationKey.current },
          body: JSON.stringify(body),
        },
      );
      await Promise.all([
        client.invalidateQueries({ queryKey: ['location-finance', 'recurring', session?.userId, locationId] }),
        client.invalidateQueries({ queryKey: ['location-finance', 'expenses', session?.userId, locationId] }),
        client.invalidateQueries({ queryKey: ['location-finance', 'report', session?.userId, locationId] }),
      ]);
      setRecurringForm(null);
      setNotice('Đã lưu quy tắc chi phí định kỳ.');
    } catch (e) {
      setError(financeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveExpense() {
    if (!dialog || busy) return;
    const parsed = Number(amount);
    if ((!category.trim() || !note.trim() || !occurredOn || !Number.isSafeInteger(parsed) || parsed <= 0) && entryMode === 'total') {
      setError('Hãy nhập đầy đủ tên khoản chi, số tiền, ngày phát sinh và nội dung.');
      return;
    }
    if (entryMode === 'detail' && (!note.trim() || !occurredOn || rows.length > 100 ||
      rows.some((r) => !r.name.trim() || !Number.isSafeInteger(Number(r.amount)) || Number(r.amount) <= 0))) {
      setError('Mỗi hạng mục cần có tên và số tiền hợp lệ.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const expenseType: ExpenseInput['expenseType'] = dialog === 'initial' ? 'INITIAL_INVESTMENT' : 'OPERATING';
      const base: ExpenseInput = {
        locationId, roomId: null, expenseType, category: category.trim(), amount,
        occurredOn, note: note.trim(),
      };
      if (entryMode === 'total') {
        await api.createExpense(base, mutationKey.current);
      } else {
        // Submit the whole declaration atomically. No partial series of
        // independent POST /expenses calls on a network interruption.
        await propertyApi.request<Expense[]>('/api/v1/location-investments', {
          method: 'POST',
          headers: { 'Idempotency-Key': mutationKey.current },
          body: JSON.stringify({
            locationId,
            occurredOn,
            items: rows.map((row) => ({
              category: row.name.trim(),
              amount: row.amount,
              note: note.trim(),
            })),
          }),
        });
      }
      await Promise.all([
        client.invalidateQueries({ queryKey: ['location-finance'] }),
        client.invalidateQueries({ queryKey: ['expenses', session?.userId] }),
        client.invalidateQueries({ queryKey: ['financial-report', session?.userId] }),
      ]);
      setDialog(null);
      setNotice('Đã ghi nhận khoản chi thành công.');
    } catch (e) {
      setError(financeError(e));
    } finally {
      setBusy(false);
    }
  }

  if (!owner) return <Alert severity="error">Chỉ Owner được truy cập thông tin vốn và chi phí của cơ sở.</Alert>;

  return (
    <Stack spacing={2}>
      <Typography variant="h2">Vốn & Chi phí</Typography>
      <Tabs
        value={section}
        onChange={(_, id: FinanceSection) => { setSection(id); setExpensePage(1); setError(''); setNotice(''); }}
        variant="scrollable"
        scrollButtons="auto"
        aria-label="Các nhóm vốn và chi phí"
        sx={{ borderBottom: '1px solid', borderColor: 'divider', '& .MuiTab-root': { textTransform: 'none', minHeight: 44 } }}
      >
        {sections.map((item) => <Tab key={item.id} value={item.id} label={item.label} />)}
      </Tabs>
      {notice && <Alert severity="success" onClose={() => setNotice('')}>{notice}</Alert>}
      {error && !dialog && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}

      {section === 'overview' && (
        <>
          {report.isPending && <LinearProgress aria-label="Đang tải số liệu tài chính" />}
          {report.isError && <Alert severity="error" action={<Button onClick={() => void report.refetch()}>Thử lại</Button>}>{financeError(report.error)}</Alert>}
          {report.data && (
            <>
              <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: 'wrap' }}>
                <Metric title="Vốn đầu tư đã ghi nhận" value={report.data.total.initialInvestment} description="Bao gồm các khoản vốn đủ điều kiện ghi nhận" />
                <Metric title="Chi phí vận hành tháng này" value={report.data.total.operatingExpenses} />
                <Metric title="Đã thu xác minh tháng này" value={report.data.total.verifiedCollections} />
                <Metric title="Công nợ hiện tại" value={report.data.total.outstandingNow} />
              </Stack>
              <Paper variant="outlined" sx={{ p: 2 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>Hiệu quả đầu tư</Typography>
                {capitalReport.isPending && <LinearProgress aria-label="Đang tải hiệu quả đầu tư" />}
                {capitalReport.isError && <Alert severity="warning" action={<Button onClick={() => void capitalReport.refetch()}>Thử lại</Button>}>Chưa tải được dữ liệu hoàn vốn.</Alert>}
                {capitalReport.data?.capital.unavailableReason ? (
                  <Alert severity="info" sx={{ mt: 1 }}>
                    Chưa đủ dữ liệu tin cậy để xác định thời gian hoàn vốn. Kiểm tra vốn ban đầu, công nợ, hoàn tiền và các kỳ báo cáo đầy đủ.
                  </Alert>
                ) : capitalReport.data ? (
                  <Stack direction="row" spacing={3} sx={{ mt: 1, flexWrap: 'wrap' }}>
                    <Box><Typography variant="caption">Vốn còn thu hồi</Typography><Typography sx={{ fontWeight: 700 }}><Amount value={capitalReport.data.capital.remainingCapital} /></Typography></Box>
                    <Box><Typography variant="caption">Tiến độ thu hồi</Typography><Typography sx={{ fontWeight: 700 }}>{capitalReport.data.capital.recoveryPercent}%</Typography></Box>
                    <Box><Typography variant="caption">Dự kiến còn lại</Typography><Typography sx={{ fontWeight: 700 }}>{capitalReport.data.capital.estimatedRemainingMonths} tháng</Typography></Box>
                  </Stack>
                ) : null}
                <Typography variant="caption" color="text.secondary">
                  Dự báo dựa trên 6 tháng hoàn chỉnh gần nhất ({baseline.from} đến {baseline.to}), không phải cam kết hoàn vốn.
                </Typography>
              </Paper>
              {capitalAssets.isError && <Alert severity="warning">Không tải được vốn đầu tư tài sản. <Button onClick={() => void capitalAssets.refetch()}>Thử lại</Button></Alert>}
              {capitalAssets.data && (
                <Paper variant="outlined" sx={{ p: 2 }}>
                  <Typography sx={{ fontWeight: 700, mb: 1 }}>Đầu tư tài sản đã xác định</Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <Metric title="Tài sản phòng" value={capitalAssets.data.roomsTotal} />
                    <Metric title="Tài sản chung" value={capitalAssets.data.commonTotal} />
                  </Stack>
                </Paper>
              )}
              {(capitalAssets.data == null || capitalAssets.data.unpricedCount > 0 ||
                capitalAssets.data.unreviewedRoomCount > 0 || capitalAssets.data.unreviewedCommonCount > 0) && (
                <Alert severity="info">Vốn đầu tư tài sản chỉ được tính sau khi kiểm kê xác nhận. Tài sản thiếu đơn giá hoặc chưa kiểm kê không được mặc định bằng 0.</Alert>
              )}
            </>
          )}
        </>
      )}

      {section === 'assets' && (
        <Stack spacing={2}>
          <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="h6">Vốn đầu tư tài sản</Typography>
            <Chip label="Tự động từ kiểm kê" size="small" variant="outlined" />
          </Stack>
          {capitalAssets.isPending && <LinearProgress aria-label="Đang tổng hợp vốn tài sản" />}
          {capitalAssets.isError && <Alert severity="error" action={<Button onClick={() => void capitalAssets.refetch()}>Thử lại</Button>}>{financeError(capitalAssets.error)}</Alert>}
          {capitalAssets.data && (
            <>
              <Stack direction="row" useFlexGap spacing={1.5} sx={{ flexWrap: 'wrap' }}>
                <Metric title="Tổng giá trị đã xác định" value={capitalAssets.data.knownTotal} />
                <Metric title="Tài sản phòng" value={capitalAssets.data.roomsTotal} />
                <Metric title="Tài sản chung" value={capitalAssets.data.commonTotal} />
              </Stack>
              {(capitalAssets.data.unpricedCount > 0 ||
                capitalAssets.data.unreviewedRoomCount > 0 ||
                capitalAssets.data.unreviewedCommonCount > 0) && (
                <Alert severity="warning">
                  Vốn tài sản chưa đầy đủ: {capitalAssets.data.unpricedCount} tài sản thiếu đơn giá đầu tư,
                  {' '}{capitalAssets.data.unreviewedRoomCount} phòng và {capitalAssets.data.unreviewedCommonCount} khu vực chung chưa hoàn tất kiểm kê.
                  Không dùng tổng hiện tại để kết luận đã hoàn vốn.
                </Alert>
              )}
              <Tabs
                value={capitalScope}
                onChange={(_, v: 'room' | 'common') => setCapitalScope(v)}
                aria-label="Phân loại vốn tài sản"
              >
                <Tab value="room" label="Tài sản phòng" sx={{ textTransform: 'none' }} />
                <Tab value="common" label="Tài sản chung cơ sở" sx={{ textTransform: 'none' }} />
              </Tabs>
              {capitalAssets.data.groups.filter((group) => group.scope === capitalScope).length === 0 && (
                <Empty>Chưa có dữ liệu tài sản thực tế thuộc nhóm này.</Empty>
              )}
              {capitalAssets.data.groups.filter((group) => group.scope === capitalScope).map((group) => (
                <Accordion
                  key={group.id}
                  variant="outlined"
                  disableGutters
                  sx={{ boxShadow: 'none', '&:before': { display: 'none' } }}
                >
                  <AccordionSummary expandIcon={<ChevronDown size={18} />}>
                    <Stack direction="row" spacing={2} sx={{ width: '100%', alignItems: 'center', justifyContent: 'space-between', pr: 1 }}>
                      <Box>
                        <Typography sx={{ fontWeight: 700 }}>{group.name}</Typography>
                        <Typography variant="caption" color="text.secondary">{group.assets.length} nhóm tài sản</Typography>
                      </Box>
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        {!group.verified && <Chip label="Cần đối chiếu" size="small" color="warning" variant="outlined" />}
                        <Typography sx={{ fontVariantNumeric: 'tabular-nums' }}><Amount value={group.knownTotal} /></Typography>
                      </Stack>
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails>
                    {!group.verified && !group.assets.some((asset) => asset.totalCost != null) ? (
                      <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
                        <Typography color="text.secondary">Cần kiểm kê trước khi ghi nhận vốn đầu tư tài sản.</Typography>
                        <Button component={Link} to={`/locations/${locationId}/assets?tab=review`} size="small" variant="outlined">Đi đến kiểm kê</Button>
                      </Stack>
                    ) : (
                      <TableContainer>
                        <Table size="small">
                          <TableHead><TableRow>
                            <TableCell>Tài sản</TableCell><TableCell align="right">SL</TableCell>
                            <TableCell align="right">Đơn giá hiện lưu</TableCell><TableCell align="right">Vốn đã ghi nhận</TableCell>
                          </TableRow></TableHead>
                          <TableBody>
                            {group.assets.map((asset) => (
                              <TableRow key={asset.id}>
                                <TableCell>{asset.name}</TableCell>
                                <TableCell align="right">{asset.quantity}</TableCell>
                                <TableCell align="right">{asset.unitCost == null ? <Chip size="small" color="warning" variant="outlined" label="Thiếu giá" /> : <Amount value={asset.unitCost} />}</TableCell>
                                <TableCell align="right"><Amount value={asset.totalCost} /></TableCell>
                              </TableRow>
                            ))}
                            {group.assets.length === 0 && <TableRow><TableCell colSpan={4}>Chưa có tài sản thực tế đã xác nhận.</TableCell></TableRow>}
                          </TableBody>
                        </Table>
                      </TableContainer>
                    )}
                  </AccordionDetails>
                </Accordion>
              ))}
            </>
          )}
        </Stack>
      )}

      {(section === 'initial' || section === 'expenses') && (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="h6">{section === 'initial' ? 'Đầu tư ban đầu & bổ sung khác' : 'Chi phí phát sinh'}</Typography>
            <Button variant="contained" startIcon={<Plus size={17} />} onClick={() => openCreate(section === 'initial' ? 'initial' : 'expenses')}>
              {section === 'initial' ? 'Thêm đầu tư khác' : 'Thêm chi phí'}
            </Button>
          </Stack>
          {section === 'initial' && (
            <Alert severity="info">Chỉ nhập các khoản đầu tư không nằm trong giá trị tài sản đã kiểm kê. Có thể khai báo một khoản tổng để tránh nhập từng hóa đơn.</Alert>
          )}
          {expenses.isPending && <LinearProgress />}
          {expenses.isError && <Alert severity="error" action={<Button onClick={() => void expenses.refetch()}>Thử lại</Button>}>{financeError(expenses.error)}</Alert>}
          {expenses.data && <>
            <ExpenseList records={allVisibleExpenses} title={section === 'initial' ? 'khoản đầu tư khác' : 'chi phí phát sinh'} onView={setInspect} />
            <TablePagination
              component="div"
              count={expenses.data.total}
              page={expenses.data.page - 1}
              rowsPerPage={expenses.data.pageSize}
              rowsPerPageOptions={[expenses.data.pageSize]}
              onPageChange={(_, page) => setExpensePage(page + 1)}
              labelRowsPerPage="Số dòng"
              labelDisplayedRows={({ from, to, count }) => `${from}–${to} / ${count}`}
            />
          </>}
        </Stack>
      )}

      {section === 'recurring' && (
        <Stack spacing={2}>
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <Typography variant="h6">Chi phí định kỳ</Typography>
            <Button variant="contained" startIcon={<Plus size={16} />} onClick={() => openRecurring()}>Thêm định kỳ</Button>
          </Stack>
          <Typography variant="body2" color="text.secondary">
            Ngày bắt đầu là mốc phát sinh; mỗi kỳ lặp lại cùng ngày (tháng ngắn dùng ngày cuối tháng). Khoản chi phát sinh chưa được xem là đã thanh toán.
          </Typography>
          {recurring.isPending && <LinearProgress />}
          {recurring.isError && <Alert severity="error" action={<Button onClick={() => void recurring.refetch()}>Thử lại</Button>}>{financeError(recurring.error)}</Alert>}
          {recurring.data && (
            recurring.data.length === 0 ? <Empty>Chưa có quy tắc chi phí định kỳ cho cơ sở.</Empty> :
              <TableContainer component={Paper} variant="outlined">
                <Table size="small" sx={{ '& td, & th': { borderRight: '1px solid', borderRightColor: 'divider' } }}>
                  <TableHead><TableRow>
                    <TableCell>Khoản chi</TableCell>
                    <TableCell>Chu kỳ</TableCell>
                    <TableCell>Ngày bắt đầu</TableCell>
                    <TableCell align="right">Số tiền/kỳ</TableCell>
                    <TableCell>Trạng thái</TableCell>
                    <TableCell align="right">Thao tác</TableCell>
                  </TableRow></TableHead>
                  <TableBody>
                    {recurring.data.map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell>{rule.name}</TableCell>
                        <TableCell>{recurringFrequency[rule.frequency]}</TableCell>
                        <TableCell>
                          {rule.startsOn.split('-').reverse().join('/')}
                          {rule.dayOfMonth !== Number(rule.startsOn.slice(8, 10)) && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              Quy tắc cũ: ngày {rule.dayOfMonth} mỗi kỳ
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell align="right"><Amount value={rule.amount} /></TableCell>
                        <TableCell><Chip size="small" variant="outlined" color={rule.active ? 'success' : 'default'} label={rule.active ? 'Đang áp dụng' : 'Ngừng áp dụng'} /></TableCell>
                        <TableCell align="right"><Button size="small" onClick={() => openRecurring(rule)}>Điều chỉnh</Button></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
          )}
        </Stack>
      )}

      <Dialog open={!!dialog} onClose={() => { if (!busy) setDialog(null); }} fullWidth maxWidth="sm">
        <DialogTitle>{dialog === 'initial' ? 'Ghi nhận đầu tư khác' : 'Ghi nhận chi phí phát sinh'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {dialog === 'initial' && (
              <Tabs value={entryMode} onChange={(_, mode: EntryMode) => setEntryMode(mode)} variant="fullWidth">
                <Tab value="total" label="Nhập tổng" />
                <Tab value="detail" label="Nhập chi tiết" />
              </Tabs>
            )}
            {entryMode === 'total' || dialog === 'expenses' ? (
              <>
                <TextField required label="Tên hạng mục" value={category} onChange={(e) => setCategory(e.target.value)} slotProps={{ htmlInput: { maxLength: 60 } }} />
                <MoneyField required label="Số tiền (VNĐ)" value={amount} onValueChange={setAmount} />
              </>
            ) : (
              <>
                {rows.map((row) => (
                  <Stack key={row.id} direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <TextField required label="Hạng mục" value={row.name} onChange={(e) => setRows((old) => old.map((item) => item.id === row.id ? { ...item, name: e.target.value } : item))} fullWidth />
                    <MoneyField required label="Số tiền" value={row.amount} onValueChange={(v) => setRows((old) => old.map((item) => item.id === row.id ? { ...item, amount: v } : item))} />
                    <Button disabled={rows.length < 2} onClick={() => setRows((old) => old.filter((item) => item.id !== row.id))}>Bỏ</Button>
                  </Stack>
                ))}
                <Button variant="outlined" disabled={rows.length >= 100} startIcon={<Plus size={16} />} onClick={() => setRows((old) => [...old, { id: Math.max(...old.map((v) => v.id)) + 1, name: '', amount: '' }])}>Thêm hạng mục</Button>
              </>
            )}
            <TextField required type="date" label="Ngày phát sinh" value={occurredOn} onChange={(e) => setOccurredOn(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField required multiline minRows={2} label="Nội dung / chứng từ" value={note} onChange={(e) => setNote(e.target.value)} slotProps={{ htmlInput: { maxLength: 4000 } }} />
            {dialog === 'initial' && <Alert severity="warning">Không cộng lại tiền mua tài sản đã được ghi nhận từ kiểm kê. Tách riêng tiền cọc có thể thu hồi.</Alert>}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setDialog(null)}>Hủy</Button>
          <Button variant="contained" disabled={busy} onClick={() => void saveExpense()}>{busy ? 'Đang lưu…' : 'Ghi nhận'}</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!inspect} onClose={() => setInspect(null)} fullWidth maxWidth="sm">
        <DialogTitle>Chi tiết khoản chi</DialogTitle>
        <DialogContent>
          {inspect && <Stack spacing={1}>
            <Typography>{inspect.category}</Typography>
            <Typography sx={{ fontWeight: 750 }}><Amount value={inspect.amount} /></Typography>
            <Typography variant="body2" color="text.secondary">Ngày phát sinh: {inspect.occurredOn.split('-').reverse().join('/')}</Typography>
            <Typography variant="body2">{inspect.note}</Typography>
            <Typography variant="caption" color="text.secondary">{inspect.canEdit ? 'Khoản Owner khai báo' : 'Khoản từ nghiệp vụ nguồn; quản lý tại nghiệp vụ gốc'}</Typography>
          </Stack>}
        </DialogContent>
        <DialogActions><Button onClick={() => setInspect(null)}>Đóng</Button></DialogActions>
      </Dialog>
      <Dialog open={!!recurringForm} onClose={() => { if (!busy) setRecurringForm(null); }} fullWidth maxWidth="sm">
        <DialogTitle>{recurringForm?.existing ? 'Điều chỉnh chi phí định kỳ' : 'Thêm chi phí định kỳ'}</DialogTitle>
        <DialogContent>
          {recurringForm && (
            <Stack spacing={2} sx={{ pt: 1 }}>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField required label="Tên khoản chi" value={recurringForm.name} slotProps={{ htmlInput: { maxLength: 200 } }} onChange={(e) => setRecurringForm((v) => v && { ...v, name: e.target.value })} />
              <MoneyField required label="Số tiền mỗi kỳ (VNĐ)" value={recurringForm.amount} onValueChange={(amount) => setRecurringForm((v) => v && { ...v, amount })} />
              <TextField select required label="Chu kỳ" value={recurringForm.frequency} onChange={(e) => setRecurringForm((v) => v && { ...v, frequency: e.target.value as RecurringExpenseRule['frequency'] })}>
                {Object.entries(recurringFrequency).map(([key, label]) => <MenuItem key={key} value={key}>{label}</MenuItem>)}
              </TextField>
              <TextField type="date" required label="Ngày bắt đầu" value={recurringForm.startsOn} disabled={!!recurringForm.existing} slotProps={{ inputLabel: { shrink: true } }} onChange={(e) => setRecurringForm((v) => v && { ...v, startsOn: e.target.value })} />
              <Typography variant="caption" color="text.secondary">
                {recurringForm.frequency === 'MONTHLY'
                  ? 'Mỗi tháng hệ thống phát sinh khoản chi theo ngày bắt đầu; tháng không có ngày đó sẽ lấy ngày cuối tháng.'
                  : recurringForm.frequency === 'QUARTERLY'
                    ? 'Mỗi 3 tháng hệ thống phát sinh khoản chi theo ngày bắt đầu.'
                    : 'Mỗi năm hệ thống phát sinh khoản chi theo ngày bắt đầu.'}
              </Typography>
              <TextField select label="Trạng thái" value={recurringForm.active ? 'active' : 'inactive'} onChange={(e) => setRecurringForm((v) => v && { ...v, active: e.target.value === 'active' })}>
                <MenuItem value="active">Đang áp dụng</MenuItem>
                <MenuItem value="inactive">Ngừng áp dụng</MenuItem>
              </TextField>
              {recurringForm.existing && (
                <Alert severity="info">
                  Ngày bắt đầu không đổi để bảo toàn lịch sử. Thay đổi sẽ áp dụng từ {recurringForm.effectiveFrom.split('-').reverse().join('/')}, không sửa các kỳ đã ghi nhận.
                </Alert>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setRecurringForm(null)}>Hủy</Button>
          <Button disabled={busy} variant="contained" onClick={() => void saveRecurring()}>{busy ? 'Đang lưu…' : 'Lưu quy tắc'}</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
