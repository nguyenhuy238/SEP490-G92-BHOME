import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Dialog, Icon, Text, TouchableRipple } from 'react-native-paper';
import { ContextPortal } from '../../components/ContextPortal';
import { useWorkspaceQuery } from '../workspace/useWorkspaceQuery';
import { queryPolicies } from '../../lib/queryPolicies';
import type { MobileApi } from '../../lib/api';
import type { IncidentPage } from '../../services/incidents';
import { InvoiceFeedback } from '../../components/InvoiceDetailUi';
import { reportColors as c, reportUi as s } from './TenantIncidentStyle';

export function IncidentLookupDialog<T>({
  title,
  prefix,
  load,
  identity,
  label,
  matches,
  selected,
  choose,
  close,
}: {
  title: string;
  prefix: string;
  load: (api: MobileApi, path: string, signal: AbortSignal) => Promise<IncidentPage<T>>;
  identity: (row: T) => string;
  label: (row: T) => string;
  matches?: (row: T) => boolean;
  selected: (row: T) => boolean;
  choose: (row: T) => void;
  close: () => void;
}) {
  const [pages, setPages] = useState(1);
  return (
    <ContextPortal>
      <Dialog visible onDismiss={close} style={s.dialog}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.ScrollArea>
          <ScrollView keyboardShouldPersistTaps="handled">
            {Array.from({ length: pages }, (_, index) => (
              <LookupPage
                key={index + 1}
                page={index + 1}
                last={index + 1 === pages}
                prefix={prefix}
                load={load}
                identity={identity}
                label={label}
                matches={matches}
                selected={selected}
                choose={choose}
                next={() => setPages((value) => value + 1)}
              />
            ))}
          </ScrollView>
        </Dialog.ScrollArea>
        <Dialog.Actions>
          <Button onPress={close}>Đóng</Button>
        </Dialog.Actions>
      </Dialog>
    </ContextPortal>
  );
}
function LookupPage<T>({
  page,
  last,
  prefix,
  load,
  identity,
  label,
  matches,
  selected,
  choose,
  next,
}: {
  page: number;
  last: boolean;
  prefix: string;
  load: (api: MobileApi, path: string, signal: AbortSignal) => Promise<IncidentPage<T>>;
  identity: (row: T) => string;
  label: (row: T) => string;
  matches?: (row: T) => boolean;
  selected: (row: T) => boolean;
  choose: (row: T) => void;
  next: () => void;
}) {
  const query = useWorkspaceQuery<IncidentPage<T>>(`${prefix}page=${page}&pageSize=20`, {
    load,
    cache: queryPolicies.rooms,
  });
  const rows = query.data?.items.filter((row) => !matches || matches(row)) ?? [];
  const more = !!query.data && page * 20 < query.data.totalCount;
  return (
    <View>
      <InvoiceFeedback {...query} />
      {rows.map((row) => (
        <TouchableRipple
          key={identity(row)}
          accessibilityRole="button"
          accessibilityLabel={label(row)}
          accessibilityState={{ selected: selected(row) }}
          onPress={() => choose(row)}
        >
          <View style={s.modalRow}>
            <View style={s.row}>
              <Text style={[s.body, s.grow]}>{label(row)}</Text>
              {selected(row) && <Icon source="check-circle" size={20} color={c.blue} />}
            </View>
          </View>
        </TouchableRipple>
      ))}
      {query.data && !rows.length && (
        <Text style={s.helper}>
          {more
            ? 'Chưa có lựa chọn phù hợp ở trang này. Bạn có thể tải thêm.'
            : 'Không có lựa chọn phù hợp trong kết quả này.'}
        </Text>
      )}
      {last && more && (
        <Button compact disabled={query.fetching} onPress={next}>
          Tải thêm
        </Button>
      )}
    </View>
  );
}
