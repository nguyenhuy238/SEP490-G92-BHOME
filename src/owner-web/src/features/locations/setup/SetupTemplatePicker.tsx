import { useState, type DragEvent, type ReactNode } from 'react';
import { Box, Button, Chip, Paper, Stack, TextField, Typography } from '@mui/material';
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
}: {
  title: string;
  items: PickerItem[];
  selected?: string[];
  add: (id: string) => void;
  kind: string;
  empty?: string;
  children?: ReactNode;
}) {
  const [search, setSearch] = useState('');
  const visible = items.filter((item) =>
    `${item.name} ${item.detail}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  return (
    <Paper variant="outlined" sx={{ p: 2, bgcolor: 'background.default', minWidth: 0 }}>
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" sx={{ fontWeight: 750 }}>
          {title}
        </Typography>
        <TextField
          size="small"
          fullWidth
          label={`Tìm ${title.toLocaleLowerCase()}`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{ input: { startAdornment: <Search size={16} style={{ marginRight: 8 }} /> } }}
        />
        {children}
        <Box sx={{ maxHeight: 375, overflowY: 'auto', pr: 0.5 }}>
          <Stack spacing={1}>
            {visible.map((item) => {
              const used = selected?.includes(item.id) ?? false;
              return (
                <Paper
                  key={item.id}
                  variant="outlined"
                  draggable={!used}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(setupDragMime, JSON.stringify({ kind, id: item.id }));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  sx={{ p: 1.5, cursor: used ? 'default' : 'grab' }}
                >
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <GripVertical size={16} color="#8290a8" />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {item.name}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
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
                      >
                        Thêm
                      </Button>
                    )}
                  </Stack>
                </Paper>
              );
            })}
            {!visible.length && (
              <Typography color="text.secondary" variant="body2">
                {empty ?? 'Không có mẫu đã công bố phù hợp.'}
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
        borderRadius: 2,
        p: 1.5,
        minHeight: 160,
      }}
    >
      {children}
    </Box>
  );
}
