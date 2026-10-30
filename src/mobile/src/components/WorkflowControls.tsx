import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Dialog, Icon, Portal, RadioButton, Text, TextInput } from 'react-native-paper';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { CameraCapture } from './CameraCapture';
import { Action, Box, Heading, Pill, Row, ui } from './WorkspaceKit';
import { colors as c } from '../theme/theme';

export interface Choice {
  id: string;
  label: string;
}
export function ChoiceField({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: Choice[];
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 4 }}>
      <Text variant="labelMedium">{label}</Text>
      <Button
        mode="outlined"
        icon="chevron-down"
        disabled={disabled}
        onPress={() => setOpen(true)}
        contentStyle={{
          flexDirection: 'row-reverse',
          justifyContent: 'space-between',
          minHeight: 48,
        }}
        style={{ borderRadius: 10, borderColor: c.border }}
      >
        {options.find((item) => item.id === value)?.label ?? 'Chọn…'}
      </Button>
      <Portal>
        <Dialog visible={open} onDismiss={() => setOpen(false)} style={{ maxHeight: '80%' }}>
          <Dialog.Title>{label}</Dialog.Title>
          <Dialog.ScrollArea>
            <ScrollView>
              {options.map((item) => (
                <RadioButton.Item
                  key={item.id}
                  label={item.label}
                  value={item.id}
                  status={value === item.id ? 'checked' : 'unchecked'}
                  onPress={() => {
                    onChange(item.id);
                    setOpen(false);
                  }}
                />
              ))}
              {!options.length && (
                <Text style={{ padding: 20 }}>Không có lựa chọn trong phạm vi được phép.</Text>
              )}
            </ScrollView>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setOpen(false)}>Đóng</Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </View>
  );
}
export function Input({
  label,
  value,
  onChange,
  numeric = false,
  multiline = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  numeric?: boolean;
  multiline?: boolean;
  disabled?: boolean;
}) {
  return (
    <TextInput
      mode="outlined"
      label={label}
      value={value}
      onChangeText={onChange}
      keyboardType={numeric ? 'decimal-pad' : 'default'}
      multiline={multiline}
      disabled={disabled}
      autoCapitalize={numeric ? 'none' : 'sentences'}
      style={{ backgroundColor: c.white }}
    />
  );
}
export function EvidenceInput({
  label = 'Ảnh bằng chứng',
  count,
  onChange,
}: {
  label?: string;
  count: number;
  onChange: (count: number) => void;
}) {
  const { preview } = useWorkspace();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  return (
    <View style={{ gap: 8 }}>
      <Heading title={label} detail={`${count}/5 ảnh • Tối đa 5 MB/ảnh`} />
      {preview ? (
        <Button
          mode="outlined"
          icon="image-plus-outline"
          disabled={count >= 5}
          onPress={() => onChange(count + 1)}
        >
          Thêm ảnh mẫu (không tải lên)
        </Button>
      ) : (
        <CameraCapture
          key={revision}
          label="Chụp ảnh minh chứng"
          disabled={count >= 5}
          retainPreview
          onCapture={async (bytes) => {
            if (bytes.byteLength > 5 * 1024 * 1024) {
              setError('Ảnh vượt quá 5 MB.');
              return;
            }
            onChange(count + 1);
          }}
        />
      )}
      {count > 0 && (
        <Row>
          <Icon source="image-multiple-outline" color={c.blue} size={22} />
          <Text variant="bodySmall" style={ui.grow}>
            {count} ảnh {preview ? 'minh họa' : 'tạm thời, chưa tải máy chủ'}
          </Text>
          <Button
            onPress={() => {
              onChange(0);
              setRevision((value) => value + 1);
            }}
          >
            Xóa tất cả
          </Button>
        </Row>
      )}
      {!!error && <Text style={ui.red}>{error}</Text>}
    </View>
  );
}
export function SubmissionResult({
  title,
  onEdit,
  status = 'Chờ Owner xem xét',
}: {
  title: string;
  onEdit: () => void;
  status?: string;
}) {
  return (
    <Box>
      <Icon source="check-circle-outline" size={46} color={c.green} />
      <Heading title={title} />
      <Pill tone="amber">{status} • MÔ PHỎNG</Pill>
      <Text>
        Bản xem trước đã ghi nhận trạng thái trong màn hình này. Chưa gửi API, chưa thay đổi hợp
        đồng, thanh toán hay trạng thái phòng.
      </Text>
      <Action secondary onPress={onEdit}>
        Quay lại chỉnh sửa bản mẫu
      </Action>
    </Box>
  );
}
export function NotConnected({ title }: { title: string }) {
  return (
    <Box>
      <Heading title={title} />
      <Text>
        Chưa có API nghiệp vụ được xác nhận để tải hoặc lưu dữ liệu của tài khoản này. Hãy dùng chế
        độ xem mẫu để kiểm tra form và trạng thái tương tác.
      </Text>
    </Box>
  );
}
export function RequestHistory({ kind }: { kind: string }) {
  const { requests } = useWorkspace();
  const items = requests.filter((item) => item.kind === kind);
  if (!items.length) return null;
  return (
    <Box>
      <Heading title="Yêu cầu vừa tạo trong phiên xem mẫu" />
      {items.map((item) => (
        <View key={item.id} style={ui.soft}>
          <Pill tone="amber">Chờ xử lý • Mô phỏng</Pill>
          <Text variant="labelSmall" style={ui.muted}>
            {item.id}
          </Text>
          <Text variant="bodySmall">{item.summary}</Text>
        </View>
      ))}
    </Box>
  );
}
