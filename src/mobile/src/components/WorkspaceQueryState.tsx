import React from 'react';
import { ActivityIndicator, Text } from 'react-native-paper';
import { Action, Box, Row, ui } from './WorkspaceKit';
import { conciseMessage } from '../lib/toast';

export function QueryState({
  loading,
  error,
  reload,
}: {
  loading: boolean;
  error: string;
  reload: () => void;
}) {
  return (
    <>
      {loading && <ActivityIndicator accessibilityLabel="Đang tải dữ liệu" />}
      {!!error && (
        <Box>
          <Text accessibilityRole="alert" style={ui.red}>
            {conciseMessage(error)}
          </Text>
        </Box>
      )}
      <Action secondary disabled={loading} icon="refresh" onPress={reload}>
        Tải lại dữ liệu
      </Action>
    </>
  );
}
export function Pagination({
  page,
  total,
  pageSize = 20,
  loading,
  onChange,
}: {
  page: number;
  total: number;
  pageSize?: number;
  loading: boolean;
  onChange: (page: number) => void;
}) {
  return (
    <Row spread>
      <Action secondary disabled={loading || page <= 1} onPress={() => onChange(page - 1)}>
        Trước
      </Action>
      <Text>
        Trang {page} · {total} mục
      </Text>
      <Action
        secondary
        disabled={loading || page * pageSize >= total}
        onPress={() => onChange(page + 1)}
      >
        Sau
      </Action>
    </Row>
  );
}
