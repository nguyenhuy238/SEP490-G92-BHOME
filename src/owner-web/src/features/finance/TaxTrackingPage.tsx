import { TextField, ValidatedForm } from '../../components/common/ValidatedForm';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  Pagination,
  Stack,
  Typography,
} from '@mui/material';
import { Link } from 'react-router';
import {
  taxPrivacyClient,
  taxTrackingStatuses,
  type BusinessProfile,
  type TaxTracking,
  type TaxTrackingInput,
} from '../../../../../packages/client-core/src/taxPrivacy';
import {
  assetLifecycleClient,
  lifecycleError,
  type LegalRecord,
} from '../../../../../packages/client-core/src/assetLifecycle';
import type { SetupDocument } from '../../../../../packages/client-core/src/propertySetup';
import {
  displayContractDate,
  formatContractMoney,
} from '../../../../../packages/client-core/src/contracts';
import { PageHeader } from '../../components/common/PortalUI';
import { MoneyField } from '../../components/common/MoneyField';
import { useMeterApi } from '../meters/useMeterApi';

export default function TaxTrackingPage() {
  const { request } = useMeterApi();
  const api = taxPrivacyClient(request);
  const cache = useQueryClient();
  const [profilePage, setProfilePage] = useState(1);
  const [page, setPage] = useState(1);
  const [profileForm, setProfileForm] = useState<SetupDocument<BusinessProfile> | 'new' | null>(
    null,
  );
  const [taxForm, setTaxForm] = useState<SetupDocument<TaxTracking> | 'new' | null>(null);
  const [historyId, setHistoryId] = useState<string | null>(null);
  const history = useQuery({
    queryKey: ['tax-obligation-versions', historyId],
    queryFn: ({ signal }) => api.taxVersions(historyId!, signal),
    enabled: !!historyId,
  });
  const download = useMutation({
    mutationFn: async (record: SetupDocument<TaxTracking>) => {
      const details = record.data.details;
      const blob = await request<Blob>(
        `/api/v1/location-legal-records/${details.evidenceRecordId}/versions/${details.evidenceVersion}/file`,
        {},
        'blob',
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `chung-tu-v${details.evidenceVersion}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  const profiles = useQuery({
    queryKey: ['tax-business-profiles', profilePage],
    queryFn: ({ signal }) => api.profiles(profilePage, signal),
  });
  const taxes = useQuery({
    queryKey: ['tax-obligations', page],
    queryFn: ({ signal }) => api.taxes(page, signal),
  });
  return (
    <Stack spacing={2}>
      <PageHeader
        title="Thuế & chứng từ"
        actions={<Button onClick={() => setTaxForm('new')}>Ghi nhận kỳ nghĩa vụ</Button>}
      />
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6">Chủ thể kinh doanh</Typography>
        <Button onClick={() => setProfileForm('new')}>Thêm chủ thể</Button>
      </Stack>
      {(profiles.isError || taxes.isError) && (
        <Alert
          severity="error"
          action={
            <Button
              onClick={() => {
                void profiles.refetch();
                void taxes.refetch();
              }}
            >
              Thử lại
            </Button>
          }
        >
          {lifecycleError(profiles.error ?? taxes.error)}
        </Alert>
      )}
      {(profiles.isPending || taxes.isPending) && (
        <Typography role="status">Đang tải dữ liệu…</Typography>
      )}
      {profiles.data?.totalCount === 0 && <Typography>Chưa có chủ thể kinh doanh.</Typography>}
      {profiles.data?.items.map((item) => (
        <Stack
          key={item.id}
          direction="row"
          sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}
        >
          <Stack>
            <Typography>
              {item.data.name} · {item.data.subjectType}
            </Typography>
            <Typography variant="caption">
              {item.data.taxIdentifier} · {item.data.locationIds.length} cơ sở · Từ{' '}
              {displayContractDate(item.data.effectiveFrom)}
            </Typography>
          </Stack>
          <Button sx={{ flexShrink: 0, whiteSpace: 'nowrap' }} onClick={() => setProfileForm(item)}>
            Cập nhật
          </Button>
        </Stack>
      ))}
      {profiles.data && profiles.data.totalCount > 20 && (
        <Pagination
          page={profilePage}
          count={Math.ceil(profiles.data.totalCount / 20)}
          onChange={(_, value) => setProfilePage(value)}
        />
      )}
      <Typography variant="h6">Kỳ nghĩa vụ được Owner ghi nhận</Typography>
      {taxes.data?.totalCount === 0 && <Typography>Chưa có kỳ nghĩa vụ thuế.</Typography>}
      {taxes.data?.items.map((item) => (
        <Stack
          key={item.id}
          spacing={1}
          sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 2 }}
        >
          <Typography>
            {item.data.details.obligationType} · {displayContractDate(item.data.details.periodFrom)}{' '}
            – {displayContractDate(item.data.details.periodTo)} · {taxTrackingStatuses[item.status]}
          </Typography>
          <Typography>
            Khai báo {formatContractMoney(item.data.details.declaredAmount)} · Đã nộp{' '}
            {formatContractMoney(item.data.details.paidAmount)} · Hạn{' '}
            {displayContractDate(item.data.details.deadline)}
          </Typography>
          <Typography variant="body2">
            Thực thu tham chiếu {formatContractMoney(item.data.referenceRevenue)} từ{' '}
            {item.data.locationIdsSnapshot.length} cơ sở, theo snapshot đã lưu
          </Typography>
          <Typography variant="caption">
            Số liệu tham chiếu dùng cho theo dõi nội bộ. Owner xác định doanh thu tính thuế và nghĩa
            vụ áp dụng.
          </Typography>
          <Button sx={{ alignSelf: 'flex-start' }} onClick={() => setTaxForm(item)}>
            Cập nhật chứng từ và tiến độ
          </Button>
          <Button sx={{ alignSelf: 'flex-start' }} onClick={() => setHistoryId(item.id)}>
            Lịch sử ghi nhận
          </Button>
        </Stack>
      ))}
      {taxes.data && taxes.data.totalCount > 20 && (
        <Pagination
          page={page}
          count={Math.ceil(taxes.data.totalCount / 20)}
          onChange={(_, value) => setPage(value)}
        />
      )}
      {profileForm && (
        <BusinessProfileForm
          record={profileForm === 'new' ? undefined : profileForm}
          onClose={() => setProfileForm(null)}
          onSaved={() => {
            setProfileForm(null);
            void cache.invalidateQueries({ queryKey: ['tax-business-profiles'] });
          }}
        />
      )}
      {taxForm && (
        <TaxObligationForm
          record={taxForm === 'new' ? undefined : taxForm}
          onClose={() => setTaxForm(null)}
          onSaved={() => {
            setTaxForm(null);
            void cache.invalidateQueries({ queryKey: ['tax-obligations'] });
            void cache.invalidateQueries({ queryKey: ['tax-obligation-versions'] });
          }}
        />
      )}
      <Dialog open={!!historyId} onClose={() => setHistoryId(null)} fullWidth>
        <DialogTitle>Lịch sử kỳ nghĩa vụ</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            {history.isPending && <Typography role="status">Đang tải lịch sử…</Typography>}
            {(history.isError || download.isError) && (
              <Alert severity="error">{lifecycleError(history.error ?? download.error)}</Alert>
            )}
            {history.data?.map((record) => (
              <Stack key={record.version} spacing={1}>
                <Typography>
                  Phiên bản {record.version} · {taxTrackingStatuses[record.status]}
                </Typography>
                <Typography>{record.data.details.note}</Typography>
                <Typography>
                  Đã nộp {formatContractMoney(record.data.details.paidAmount)}
                </Typography>
                {record.data.details.evidenceRecordId && (
                  <Button disabled={download.isPending} onClick={() => download.mutate(record)}>
                    Tải chứng từ phiên bản {record.data.details.evidenceVersion}
                  </Button>
                )}
              </Stack>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setHistoryId(null)}>Đóng</Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}

function BusinessProfileForm({
  record,
  onClose,
  onSaved,
}: {
  record?: SetupDocument<BusinessProfile>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { request } = useMeterApi();
  const [id] = useState(() => record?.id ?? crypto.randomUUID());
  const [locations, setLocations] = useState(record?.data.locationIds ?? []);
  const lookup = useQuery({
    queryKey: ['tax-location-choices'],
    queryFn: () => request<{ id: string; label: string }[]>('/api/v1/capture/locations'),
  });
  const mutation = useMutation({
    mutationFn: (form: FormData) => {
      const text = (key: string) => String(form.get(key) ?? '').trim();
      return taxPrivacyClient(request).profile(id, {
        subjectType: text('subjectType'),
        name: text('name'),
        taxIdentifier: text('taxIdentifier'),
        registrationNumber: text('registrationNumber') || null,
        address: text('address'),
        locationIds: locations,
        effectiveFrom: text('effectiveFrom'),
        effectiveTo: text('effectiveTo') || null,
        expectedVersion: record?.version ?? 0,
      });
    },
    onSuccess: onSaved,
  });
  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth>
      <ValidatedForm
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(new FormData(event.currentTarget));
        }}
      >
        <DialogTitle>Chủ thể kinh doanh</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {(mutation.isError || lookup.isError) && (
              <Alert severity="error">{lifecycleError(mutation.error ?? lookup.error)}</Alert>
            )}
            {['subjectType', 'name', 'taxIdentifier', 'registrationNumber', 'address'].map(
              (name, index) => (
                <TextField
                  key={name}
                  required={name !== 'registrationNumber'}
                  name={name}
                  label={
                    [
                      'Loại chủ thể',
                      'Tên chủ thể',
                      'Mã số thuế / định danh',
                      'Số đăng ký',
                      'Địa chỉ',
                    ][index]
                  }
                  defaultValue={record?.data[name as keyof BusinessProfile] ?? ''}
                />
              ),
            )}
            <Typography>Cơ sở liên kết</Typography>
            {lookup.data?.map((location) => (
              <FormControlLabel
                key={location.id}
                label={location.label}
                control={
                  <Checkbox
                    checked={locations.includes(location.id)}
                    onChange={(_, checked) =>
                      setLocations((items) =>
                        checked
                          ? [...items, location.id]
                          : items.filter((id) => id !== location.id),
                      )
                    }
                  />
                }
              />
            ))}
            <TextField
              required
              type="date"
              label="Hiệu lực từ"
              name="effectiveFrom"
              defaultValue={record?.data.effectiveFrom}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              type="date"
              label="Hiệu lực đến nếu có"
              name="effectiveTo"
              defaultValue={record?.data.effectiveTo ?? ''}
              slotProps={{ inputLabel: { shrink: true } }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={mutation.isPending} onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" disabled={mutation.isPending || locations.length === 0}>
            Lưu chủ thể
          </Button>
        </DialogActions>
      </ValidatedForm>
    </Dialog>
  );
}

function TaxObligationForm({
  record,
  onClose,
  onSaved,
}: {
  record?: SetupDocument<TaxTracking>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { request } = useMeterApi();
  const details = record?.data.details;
  const [id] = useState(() => record?.id ?? crypto.randomUUID());
  const [profileId, setProfileId] = useState(details?.businessProfileId ?? '');
  const [declared, setDeclared] = useState(details?.declaredAmount ?? '');
  const [paid, setPaid] = useState(details?.paidAmount ?? '0');
  const [profilePage, setProfilePage] = useState(1);
  const [evidencePage, setEvidencePage] = useState(1);
  const [selectedProfile, setSelectedProfile] = useState<SetupDocument<BusinessProfile> | null>(
    null,
  );
  const [selectedLocation, setSelectedLocation] = useState('');
  const [selectedEvidence, setSelectedEvidence] = useState<SetupDocument<LegalRecord> | null>(null);
  const locationChoices = useQuery({
    queryKey: ['tax-location-choices'],
    queryFn: () => request<{ id: string; label: string }[]>('/api/v1/capture/locations'),
  });
  const profiles = useQuery({
    queryKey: ['tax-business-profile-picker', profilePage],
    queryFn: ({ signal }) => taxPrivacyClient(request).profiles(profilePage, signal),
  });
  const profile = selectedProfile ?? profiles.data?.items.find((item) => item.id === profileId);
  const locationIds = record?.data.locationIdsSnapshot ?? profile?.data.locationIds ?? [];
  const evidenceLocation = selectedLocation || locationIds[0];
  const evidence = useQuery({
    queryKey: ['tax-evidence', evidenceLocation, evidencePage],
    queryFn: ({ signal }) =>
      assetLifecycleClient(request).legalRecords(evidenceLocation!, evidencePage, signal),
    enabled: !!evidenceLocation,
  });
  const mutation = useMutation({
    mutationFn: (form: FormData) => {
      const text = (key: string) => String(form.get(key) ?? '').trim();
      const file = selectedEvidence;
      const input: TaxTrackingInput = {
        businessProfileId: profileId,
        periodFrom: details?.periodFrom ?? text('from'),
        periodTo: details?.periodTo ?? text('to'),
        obligationType: text('type'),
        deadline: text('deadline'),
        declaredAmount: declared,
        paidAmount: paid,
        paidOn: text('paidOn') || null,
        evidenceRecordId: file?.id ?? details?.evidenceRecordId ?? null,
        evidenceVersion: file?.version ?? details?.evidenceVersion ?? null,
        status: text('status'),
        note: text('note'),
        expectedVersion: record?.version ?? 0,
      };
      return taxPrivacyClient(request).tax(id, input);
    },
    onSuccess: onSaved,
  });
  return (
    <Dialog open onClose={mutation.isPending ? undefined : onClose} fullWidth>
      <ValidatedForm
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate(new FormData(event.currentTarget));
        }}
      >
        <DialogTitle>Ghi nhận kỳ nghĩa vụ và chứng từ</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {(mutation.isError || profiles.isError || evidence.isError) && (
              <Alert severity="error">
                {lifecycleError(mutation.error ?? profiles.error ?? evidence.error)}
              </Alert>
            )}
            <TextField
              required
              select
              label="Chủ thể kinh doanh"
              value={profileId}
              disabled={!!record}
              onChange={(event) => {
                setProfileId(event.target.value);
                setSelectedProfile(
                  profiles.data?.items.find((item) => item.id === event.target.value) ?? null,
                );
                setSelectedLocation('');
                setSelectedEvidence(null);
                setEvidencePage(1);
              }}
            >
              {profileId && !profiles.data?.items.some((item) => item.id === profileId) && (
                <MenuItem value={profileId}>{profile?.data.name ?? profileId}</MenuItem>
              )}
              {profiles.data?.items.map((item) => (
                <MenuItem key={item.id} value={item.id}>
                  {item.data.name}
                </MenuItem>
              ))}
            </TextField>
            {!record && profiles.data && profiles.data.totalCount > 20 && (
              <Pagination
                page={profilePage}
                count={Math.ceil(profiles.data.totalCount / 20)}
                onChange={(_, value) => setProfilePage(value)}
              />
            )}
            <TextField
              required
              type="date"
              name="from"
              label="Kỳ từ ngày"
              defaultValue={details?.periodFrom}
              disabled={!!record}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              required
              type="date"
              name="to"
              label="Kỳ đến ngày"
              defaultValue={details?.periodTo}
              disabled={!!record}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <TextField
              required
              label="Loại nghĩa vụ"
              name="type"
              defaultValue={details?.obligationType}
            />
            <TextField
              required
              type="date"
              name="deadline"
              label="Hạn thực hiện"
              defaultValue={details?.deadline}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <MoneyField
              required
              label="Số tiền Owner khai báo"
              value={declared}
              onValueChange={setDeclared}
            />
            <MoneyField required label="Số tiền đã nộp" value={paid} onValueChange={setPaid} />
            <TextField
              type="date"
              name="paidOn"
              label="Ngày thực hiện"
              defaultValue={details?.paidOn ?? ''}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            {locationIds.length > 1 && (
              <TextField
                select
                label="Cơ sở lưu chứng từ"
                value={evidenceLocation}
                onChange={(event) => {
                  setSelectedLocation(event.target.value);
                  setEvidencePage(1);
                  setSelectedEvidence(null);
                }}
              >
                {locationIds.map((locationId) => (
                  <MenuItem key={locationId} value={locationId}>
                    {locationChoices.data?.find((item) => item.id === locationId)?.label ??
                      locationId}
                  </MenuItem>
                ))}
              </TextField>
            )}
            <TextField
              select
              name="evidence"
              label="Chứng từ đã tải trong hồ sơ cơ sở"
              value={selectedEvidence?.id ?? ''}
              onChange={(event) =>
                setSelectedEvidence(
                  evidence.data?.items.find((item) => item.id === event.target.value) ?? null,
                )
              }
            >
              <MenuItem value="">Giữ chứng từ hiện tại / chưa có</MenuItem>
              {selectedEvidence &&
                !evidence.data?.items.some((item) => item.id === selectedEvidence.id) && (
                  <MenuItem value={selectedEvidence.id}>
                    {selectedEvidence.data.details.name} · Phiên bản {selectedEvidence.version}
                  </MenuItem>
                )}
              {evidence.data?.items.map((item) => (
                <MenuItem key={item.id} value={item.id}>
                  {item.data.details.name} · Phiên bản {item.version}
                </MenuItem>
              ))}
            </TextField>
            {evidence.data && evidence.data.totalCount > 20 && (
              <Pagination
                page={evidencePage}
                count={Math.ceil(evidence.data.totalCount / 20)}
                onChange={(_, value) => setEvidencePage(value)}
              />
            )}
            {evidenceLocation && (
              <Button
                component={Link}
                to={`/locations/${evidenceLocation}/settings`}
                target="_blank"
              >
                Mở hồ sơ cơ sở để tải chứng từ
              </Button>
            )}
            <TextField
              select
              name="status"
              label="Trạng thái theo dõi"
              defaultValue={details?.status ?? 'Pending'}
            >
              {Object.entries(taxTrackingStatuses).map(([value, label]) => (
                <MenuItem key={value} value={value}>
                  {label}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              required
              multiline
              name="note"
              label="Ghi chú / căn cứ Owner ghi nhận"
              defaultValue={details?.note}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button disabled={mutation.isPending} onClick={onClose}>
            Hủy
          </Button>
          <Button type="submit" disabled={mutation.isPending}>
            Lưu ghi nhận
          </Button>
        </DialogActions>
      </ValidatedForm>
    </Dialog>
  );
}
