import { useState, type DragEvent, type ReactNode } from 'react';
import { Box, Button, Chip, MenuItem, Paper, Stack, TextField, Typography } from '@mui/material';
import { GripVertical, Plus, Search } from 'lucide-react';

export const setupDragMime = 'application/x-bhome-setup-template';
export interface PickerItem {
  id: string;
  name: string;
  detail: string;
}

export function SetupTemplatePicker({
  title,
  items,
  selected,
  add,
  kind,
  empty,
  children,
  libraryActions,
}: {
  title: string;
  items: PickerItem[];
  selected?: string[];
  add: (id: string) => void;
  kind: string;
  empty?: string;
  children?: ReactNode;
  libraryActions?: ReactNode;
}) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const normalize = (value: string) =>
    value
      .toLocaleLowerCase('vi')
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/đ/g, 'd')
      .trim();
  const visible = items.filter((item) => {
    const used = selected?.includes(item.id) ?? false;
    return (
      normalize(`${item.name} ${item.detail}`).includes(normalize(search)) &&
      (!selected || filter === 'all' || (filter === 'selected' ? used : !used))
    );
  });
  return (
    <Paper variant="outlined" sx={{ p: 1.5, minWidth: 0 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
        {libraryActions}
        <TextField
          size="small"
          fullWidth
          label={`Tìm ${title.toLocaleLowerCase()}`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{ input: { startAdornment: <Search size={16} style={{ marginRight: 8 }} /> } }}
        />
        {selected && (
          <TextField
            select
            size="small"
            fullWidth
            label={`Lọc ${title.toLocaleLowerCase('vi')}`}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            <MenuItem value="all">Tất cả</MenuItem>
            <MenuItem value="available">Chưa chọn</MenuItem>
            <MenuItem value="selected">Đã chọn</MenuItem>
          </TextField>
        )}
        {children}
        <Box sx={{ maxHeight: 360, overflowY: 'auto', overflowX: 'hidden' }}>
          <Stack
            component="ul"
            divider={<Box sx={{ borderBottom: '1px solid', borderColor: 'divider' }} />}
            sx={{ m: 0, p: 0, listStyle: 'none' }}
          >
            {visible.map((item) => {
              const used = selected?.includes(item.id) ?? false;
              return (
                <Box
                  component="li"
                  key={item.id}
                  draggable={!used}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(setupDragMime, JSON.stringify({ kind, id: item.id }));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  sx={{
                    py: 1,
                    px: 0.5,
                    cursor: used ? 'default' : 'grab',
                    bgcolor: used ? 'action.selected' : 'transparent',
                  }}
                >
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    {!used && (
                      <Box
                        sx={{
                          color: 'text.secondary',
                          display: { xs: 'none', md: 'flex' },
                          flexShrink: 0,
                        }}
                      >
                        <GripVertical size={16} />
                      </Box>
                    )}
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 650, overflowWrap: 'anywhere' }}
                      >
                        {item.name}
                      </Typography>
                      <Typography
                        variant="caption"
                        color="text.secondary"
                        sx={{ overflowWrap: 'anywhere' }}
                      >
                        {item.detail}
                      </Typography>
                    </Box>
                    {used ? (
                      <Chip size="small" label="Đã chọn" />
                    ) : (
                      <Button
                        size="small"
                        aria-label={`Thêm ${item.name}`}
                        onClick={() => add(item.id)}
                        startIcon={<Plus size={15} />}
                        sx={{ flexShrink: 0, minHeight: { xs: 44, sm: 36 } }}
                      >
                        Thêm
                      </Button>
                    )}
                  </Stack>
                </Box>
              );
            })}
            {!visible.length && (
              <Typography color="text.secondary" variant="body2">
                {items.length
                  ? 'Không tìm thấy mẫu phù hợp với bộ lọc.'
                  : (empty ?? 'Chưa có mẫu đã công bố. Mở thư viện để tạo hoặc công bố mẫu.')}
              </Typography>
            )}
          </Stack>
        </Box>
      </Stack>
    </Paper>
  );
}

export function SetupDropZone({
  kind,
  add,
  children,
}: {
  kind: string;
  add: (id: string) => void;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setOver(false);
    try {
      const data = JSON.parse(event.dataTransfer.getData(setupDragMime)) as {
        kind?: string;
        id?: string;
      };
      if (data.kind === kind && data.id) add(data.id);
    } catch {
      /* ignore unrelated drag payloads */
    }
  };
  return (
    <Box
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes(setupDragMime)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      sx={{
        border: '1px dashed',
        borderColor: over ? 'primary.main' : 'divider',
        bgcolor: over ? 'action.hover' : 'transparent',
        borderRadius: '12px',
        p: 1.5,
        minWidth: 0,
        minHeight: 120,
      }}
    >
      {children}
    </Box>
  );
}
