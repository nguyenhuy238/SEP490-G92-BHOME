import { Button, Stack } from '@mui/material';
import { DataGrid, type GridColDef } from '@mui/x-data-grid';
import { viVN } from '@mui/x-data-grid/locales';
import { Eye, Pencil } from 'lucide-react';
import type { DemoDatabase, FeatureDefinition, PortalRecord } from '../../types/portal';
import { recordDisplay } from '../../utils/recordDisplay';
import { StatusChip } from '../common/PortalUI';
export function DataTable({
  definition,
  rows,
  database,
  onView,
  onEdit,
}: {
  definition: FeatureDefinition;
  rows: PortalRecord[];
  database: DemoDatabase;
  onView: (row: PortalRecord) => void;
  onEdit?: (row: PortalRecord) => void;
}) {
  const columns: GridColDef<PortalRecord>[] = definition.columns.map((column) => ({
    field: column.field,
    headerName: column.label,
    width: column.width || 170,
    minWidth: 120,
    flex: column.field === 'name' || column.field === 'description' ? 1 : undefined,
    valueGetter: (_, row) => recordDisplay(row, column.field, database, definition.kind),
    renderCell:
      column.field === 'status' ? (params) => <StatusChip label={params.row.status} /> : undefined,
  }));
  columns.push({
    field: 'actions',
    headerName: 'Thao tác',
    width: onEdit ? 110 : 75,
    sortable: false,
    filterable: false,
    renderCell: (params) => (
      <Stack direction="row" spacing={0.5}>
        <Button
          aria-label={`Xem ${params.row.code}`}
          size="small"
          sx={{ minWidth: 30 }}
          onClick={() => onView(params.row)}
        >
          <Eye size={16} />
        </Button>
        {onEdit && (
          <Button
            aria-label={`Sửa ${params.row.code}`}
            size="small"
            sx={{ minWidth: 30 }}
            onClick={() => onEdit(params.row)}
          >
            <Pencil size={14} />
          </Button>
        )}
      </Stack>
    ),
  });
  return (
    <DataGrid
      rows={rows}
      columns={columns}
      localeText={viVN.components.MuiDataGrid.defaultProps.localeText}
      initialState={{ pagination: { paginationModel: { pageSize: 10, page: 0 } } }}
      pageSizeOptions={[5, 10, 25, 50]}
      disableRowSelectionOnClick
      rowHeight={72}
      columnHeaderHeight={44}
      onRowDoubleClick={(params) => onView(params.row)}
      sx={{
        border: 0,
        minHeight: 380,
        '& .MuiDataGrid-columnHeaders': { bgcolor: '#f2f3ff', fontSize: 11 },
        '& .MuiDataGrid-cell': {
          fontSize: 12,
          display: 'flex',
          alignItems: 'center',
          lineHeight: 1.6,
          whiteSpace: 'normal',
          py: 1,
        },
        '& .MuiDataGrid-row:hover': { bgcolor: '#f5f6ff' },
        '& .MuiDataGrid-footerContainer': { fontSize: 11 },
      }}
    />
  );
}
