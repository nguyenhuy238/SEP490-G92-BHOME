import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Stack, TextField, Typography } from '@mui/material';
import { useMainDraftApi } from './useContractsApi';
import { contractError, mutationKeys } from '../../../../../packages/client-core/src/contracts';
import {
  mainDraftMessages,
  formatDraftMoney,
  type MainDraftFiles,
  type MainDraftView,
} from '../../../../../packages/client-core/src/mainDrafts';
import { MainDraftReleasePanel } from './MainDraftReleasePanel';

export function MainDraftDetailPanel({
  id,
  onChanged,
  onReleased,
}: {
  id: string;
  onChanged: () => void;
  onReleased?: () => void;
}) {
  const api = useMainDraftApi();
  const [draft, setDraft] = useState<MainDraftView | null>(null);
  const [files, setFiles] = useState<MainDraftFiles | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const lock = useRef(false),
    [keys] = useState(() => mutationKeys(() => crypto.randomUUID()));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    api
      .get(id, c.signal)
      .then((v) => {
        if (!c.signal.aborted) {
          setDraft(v);
          setDirty(false);
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(contractError(e));
      });
    return () => c.abort();
  }, [api, id]);
  async function save(preview: boolean) {
    if (!draft || lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setFiles(null);
    try {
      const input = { ...draft.input, expectedVersion: draft.version };
      const updated = await api.save(id, input, keys.get('main-draft', input));
      keys.confirmed('main-draft', input);
      setDraft(updated);
      setDirty(false);
      onChanged();
      if (preview) setFiles(await api.generate(id));
    } catch (e) {
      const code = (e as { code?: string }).code;
      setError(code && mainDraftMessages[code] ? mainDraftMessages[code] : contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function download(pdf: boolean) {
    const file = pdf ? files?.pdf : files?.docx;
    if (!file || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const bytes = await api.file(id, file.id);
      try {
        const url = URL.createObjectURL(
          new Blob([bytes], {
            type: pdf
              ? 'application/pdf'
              : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }),
        );
        const link = document.createElement('a');
        link.href = url;
        link.download = `hop-dong-nhap.${pdf ? 'pdf' : 'docx'}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } finally {
        bytes.fill(0);
      }
    } catch (e) {
      setError(contractError(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Stack spacing={2}>
      {!!error && <Alert severity="error">{error}</Alert>}
      {!draft ? (
        <Typography>Đang tải bản nháp…</Typography>
      ) : (
        <>
          <Typography variant="h6">Hợp đồng nháp {draft.id}</Typography>
          <Typography>Trạng thái: {draft.status}</Typography>
          <Typography>
            {draft.preparation.locationName} · Phòng {draft.preparation.roomNumber}
          </Typography>
          <Typography>{draft.preparation.residents.map((r) => r.fullName).join(', ')}</Typography>
          {draft.preparation.charges.map((p) => (
            <Typography key={p.id}>
              {p.name}: {formatDraftMoney(p.rate)}
            </Typography>
          ))}
          <Typography>
            Tiền cọc:{' '}
            {draft.preparation.securityDeposit === null
              ? 'Chưa cấu hình'
              : formatDraftMoney(draft.preparation.securityDeposit)}
          </Typography>
          {(['startDate', 'endDate', 'tenantPhone', 'tenantPlaceOfIssue', 'notes'] as const).map(
            (key) => (
              <TextField
                key={key}
                label={
                  {
                    startDate: 'Ngày bắt đầu',
                    endDate: 'Ngày kết thúc',
                    tenantPhone: 'Điện thoại người thuê',
                    tenantPlaceOfIssue: 'Nơi cấp CCCD',
                    notes: 'Ghi chú',
                  }[key]
                }
                type={key.endsWith('Date') ? 'date' : 'text'}
                slotProps={{ inputLabel: { shrink: true } }}
                value={draft.input[key]}
                disabled={busy || draft.status !== 'Draft'}
                onChange={(e) => {
                  setFiles(null);
                  setDirty(true);
                  setDraft((v) => v && { ...v, input: { ...v.input, [key]: e.target.value } });
                }}
              />
            ),
          )}
          {draft.status === 'Draft' && (
            <Stack direction="row" spacing={1}>
              <Button disabled={busy} onClick={() => void save(false)}>
                Lưu nháp
              </Button>
              <Button disabled={busy} variant="contained" onClick={() => void save(true)}>
                Xem trước hợp đồng
              </Button>
            </Stack>
          )}
          {files?.previewError && (
            <Alert severity="warning">
              {mainDraftMessages[files.previewError] ?? files.previewError}
            </Alert>
          )}
          {files?.pdf && (
            <Button disabled={busy} onClick={() => void download(true)}>
              Mở hoặc tải PDF
            </Button>
          )}
          {files?.docx && (
            <Button disabled={busy} onClick={() => void download(false)}>
              Tải DOCX
            </Button>
          )}
          {draft.status === 'Draft' && (
            <MainDraftReleasePanel
              key={`${draft.id}:${draft.version}`}
              draft={draft}
              disabled={dirty || busy}
              onReleased={onReleased || onChanged}
            />
          )}
        </>
      )}
    </Stack>
  );
}
