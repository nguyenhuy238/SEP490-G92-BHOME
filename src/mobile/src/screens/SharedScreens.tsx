import { NotificationsScreen } from './NotificationsScreen';
import { ProfileScreen } from './ProfileScreen';
import { useFeedbackState } from '../lib/useFeedbackState';
import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Icon, Switch, Text, TextInput } from 'react-native-paper';
import { Action, Box, Filters, Heading, InfoRow, Pill, Row, ui } from '../components/WorkspaceKit';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { colors as c } from '../theme/theme';

export function Profile() {
  return <ProfileScreen />;
}
export function Notifications() {
  return <NotificationsScreen />;
}
export function SecuritySettings() {
  const { unavailable } = useWorkspace();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useFeedbackState();
  const rules = [
    password.length >= 8,
    /[a-z]/.test(password) && /[A-Z]/.test(password),
    /\d/.test(password),
    /[^a-zA-Z0-9]/.test(password),
  ];
  const strength = rules.filter(Boolean).length;
  return (
    <>
      <Heading
        title="Bảo mật & Thiết bị"
        detail="Quản trị phương thức xác thực và phiên đăng nhập"
      />
      <Box style={{ backgroundColor: c.tint }}>
        <InfoRow
          icon="shield-check-outline"
          title="Bảo vệ tài khoản BHOME"
          detail="Trạng thái bảo mật cần được xác nhận từ máy chủ."
        />
      </Box>
      <Box>
        <Heading title="Đổi mật khẩu đăng nhập" />
        <TextInput
          label="Mật khẩu hiện tại"
          value={current}
          onChangeText={setCurrent}
          mode="outlined"
          secureTextEntry={!visible}
          autoCapitalize="none"
          right={
            <TextInput.Icon
              icon={visible ? 'eye-off-outline' : 'eye-outline'}
              onPress={() => setVisible(!visible)}
            />
          }
        />
        <TextInput
          label="Mật khẩu mới"
          value={password}
          onChangeText={setPassword}
          mode="outlined"
          secureTextEntry={!visible}
          autoCapitalize="none"
        />
        <Text variant="labelMedium">Độ mạnh mật khẩu: {strength}/4</Text>
        {[
          'Tối thiểu 8 ký tự',
          'Chữ hoa & thường',
          'Ít nhất 1 chữ số',
          'Ký tự đặc biệt (@, #…)',
        ].map((label, index) => (
          <Row key={label}>
            <Icon
              source={rules[index] ? 'check-circle-outline' : 'circle-outline'}
              color={rules[index] ? c.green : c.muted}
              size={18}
            />
            <Text variant="bodySmall">{label}</Text>
          </Row>
        ))}
        <TextInput
          label="Xác nhận mật khẩu mới"
          value={confirm}
          onChangeText={setConfirm}
          mode="outlined"
          secureTextEntry={!visible}
          autoCapitalize="none"
        />
        {!!error && <Text style={ui.red}>{error}</Text>}
        <Action
          icon="lock-reset"
          onPress={() => {
            if (!current || strength < 4 || password !== confirm || password === current)
              setError(
                'Nhập mật khẩu hiện tại, mật khẩu mới đủ 4 tiêu chí và xác nhận trùng khớp. Mật khẩu mới phải khác mật khẩu cũ.',
              );
            else {
              setError('');
              unavailable('Đổi mật khẩu');
            }
          }}
        >
          Cập nhật mật khẩu mới
        </Action>
      </Box>
      <Box>
        <Heading title="Phương thức xác thực nhanh" />
        <InfoRow
          icon="fingerprint"
          title="Face ID / Vân tay"
          detail="Chưa tích hợp • Không dùng để ký thay nhà cung cấp"
          onPress={() => unavailable('Xác thực sinh trắc học')}
        />
        <InfoRow
          icon="cellphone-lock"
          title="Xác thực 2 bước (2FA)"
          detail="Cần tích hợp xác thực từ máy chủ"
          onPress={() => unavailable('Thiết lập xác thực 2 bước')}
        />
      </Box>
      <Box>
        <Heading
          title="Thiết bị đang đăng nhập"
          action="Đăng xuất tất cả"
          onPress={() => unavailable('Thu hồi tất cả phiên')}
        />
        {[
          'iPhone 15 Pro Max|iOS • Ứng dụng BHOME Mobile',
          'iPad Air 5|iPadOS • BHOME App',
          'MacBook Pro 14|Chrome • BHOME Web Portal',
        ].map((line) => (
          <InfoRow
            key={line}
            icon="devices"
            title={line.split('|')[0]}
            detail={`${line.split('|')[1]} • Thiết bị minh họa`}
            onPress={() => unavailable('Thu hồi phiên thiết bị')}
          />
        ))}
      </Box>
      <Box>
        <Heading title="Lịch sử bảo mật gần đây" />
        <InfoRow
          icon="login"
          title="Nhật ký đăng nhập"
          detail="Chưa có dữ liệu xác thực từ API"
          onPress={() => unavailable('Xem nhật ký bảo mật')}
        />
      </Box>
      <Button
        icon="shield-alert-outline"
        textColor={c.red}
        onPress={() => unavailable('Khóa tài khoản khẩn cấp')}
      >
        Khóa khẩn cấp tài khoản
      </Button>
    </>
  );
}
const initialPreferences: Record<string, boolean> = {
  push: true,
  zalo: false,
  sms: true,
  email: true,
  report: false,
  invoices: true,
  reminders: true,
  payments: true,
  incidents: true,
  maintenance: true,
  contracts: true,
  community: false,
  quiet: true,
  haptic: true,
};
export function NotificationPreferences() {
  const { unavailable } = useWorkspace();
  const [values, setValues] = useState(initialPreferences);
  const [day, setDay] = useState('T2');
  const [time, setTime] = useState('08:00');
  const toggle = (key: string) => setValues((before) => ({ ...before, [key]: !before[key] }));
  const setting = (key: string, title: string, detail: string, locked = false) => (
    <Row key={key}>
      <View style={ui.grow}>
        <Text variant="titleMedium">{title}</Text>
        <Text variant="bodySmall" style={ui.muted}>
          {detail}
        </Text>
      </View>
      <Switch
        value={locked || values[key]}
        onValueChange={() => toggle(key)}
        disabled={locked}
        color={c.blue}
        accessibilityLabel={title}
      />
    </Row>
  );
  return (
    <>
      <Heading
        title="Cài đặt thông báo & Nhận tin"
        detail="Kiểm soát kênh nhận và tần suất cảnh báo"
      />
      <Pill tone="amber">Tùy chỉnh xem trước • Chưa lưu máy chủ</Pill>
      <Box>
        <Heading title="Kênh nhận thông báo chính" />
        {setting('push', 'Thông báo đẩy', 'Trên màn hình khóa và banner thiết bị')}
        {setting('zalo', 'Tin nhắn Zalo ZNS', 'Cần tích hợp nhà cung cấp')}
        {setting('sms', 'Tin nhắn SMS khẩn cấp', 'Theo cấu hình hệ thống và nhà cung cấp')}
        {setting('email', 'Hòm thư điện tử (Email)', 'Bản sao thông tin hóa đơn và vận hành')}
      </Box>
      <Box>
        <Heading title="Báo cáo tổng hợp tuần qua Email" />
        {setting('report', 'Nhận báo cáo hàng tuần', 'Lịch bên dưới chỉ là tùy chọn minh họa')}
        <TextInput
          mode="outlined"
          label="Giờ gửi (HH:mm)"
          value={time}
          onChangeText={setTime}
          keyboardType="numbers-and-punctuation"
        />
        <Filters
          options={['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']}
          selected={day}
          onChange={setDay}
        />
      </Box>
      <Box>
        <Heading title="Tài chính & Hóa đơn" />
        {setting('invoices', 'Hóa đơn phòng & Điện nước mới', 'Khi hóa đơn được phát hành')}
        {setting('reminders', 'Nhắc nhở hạn nộp tiền', 'Theo thời hạn được cấu hình')}
        {setting('payments', 'Xác nhận đối soát thanh toán', 'Khi hệ thống xác minh giao dịch')}
      </Box>
      <Box>
        <Heading title="Vận hành & Kỹ thuật" />
        {setting(
          'incidents',
          'Tiến độ phiếu sự cố kỹ thuật',
          'Khi tiếp nhận, cập nhật và hoàn thành',
        )}
        {setting('maintenance', 'Lịch bảo trì tòa nhà', 'Thông báo lịch bảo trì đã được phê duyệt')}
        <InfoRow icon="access-point-off" title="Cảnh báo IoT" detail="Chưa hỗ trợ trong MVP" />
      </Box>
      <Box>
        <Heading title="An ninh & Ban quản lý" />
        {setting(
          'emergency',
          'An ninh, PCCC & Khẩn cấp',
          'Không tắt cảnh báo an toàn trong giao diện mẫu',
          true,
        )}
        {setting('contracts', 'Biên bản bàn giao & Hợp đồng', 'Cập nhật hồ sơ từ hệ thống')}
        {setting('community', 'Tin tức cộng đồng', 'Bản tin của cơ sở')}
      </Box>
      <Box>
        <Heading title="Khung giờ yên tĩnh" />
        {setting('quiet', 'Giảm thông báo thứ yếu', '22:30 – 07:00 • Lịch minh họa')}
        <Text variant="bodySmall" style={ui.muted}>
          Ngoại lệ cảnh báo an toàn cần do hệ thống và chính sách thiết bị quyết định.
        </Text>
      </Box>
      <Box>
        <Heading title="Âm báo & Phản hồi xúc giác" />
        <InfoRow
          icon="music-note-outline"
          title="Giai điệu chuông"
          detail="BHOME Ping (mẫu)"
          onPress={() => unavailable('Chọn âm báo')}
        />
        {setting('haptic', 'Rung xúc giác', 'Tùy chọn giao diện, chưa điều khiển thiết bị')}
      </Box>
      <Action
        icon="check-all"
        onPress={() => {
          if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) {
            unavailable('Giờ gửi không hợp lệ; cần định dạng HH:mm');
            return;
          }
          unavailable('Lưu tùy chọn thông báo');
        }}
      >
        Lưu tùy chọn thông báo
      </Action>
      <Button
        icon="restore"
        onPress={() => {
          setValues({ ...initialPreferences });
          setDay('T2');
          setTime('08:00');
        }}
      >
        Khôi phục cài đặt mẫu
      </Button>
    </>
  );
}
