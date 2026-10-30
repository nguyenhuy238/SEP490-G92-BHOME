import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Dialog, Icon, Portal, ProgressBar, Text, TextInput } from 'react-native-paper';
import {
  Action,
  Box,
  Filters,
  Heading,
  InfoRow,
  Metric,
  Pill,
  QuickActions,
  Row,
  ui,
} from '../components/WorkspaceKit';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { sampleApprovals, type ApprovalItem } from '../services/workspaceData';
import { colors as c } from '../theme/theme';

function ApprovalCard({ item, compact = false }: { item: ApprovalItem; compact?: boolean }) {
  const { unavailable } = useWorkspace();
  const [decision, setDecision] = useState('');
  const [reason, setReason] = useState('');
  return (
    <Box>
      <Row spread>
        <Pill tone={item.urgent ? 'red' : 'blue'}>
          {item.category.toUpperCase()}
          {item.urgent ? ' • KHẨN' : ''}
        </Pill>
        <Text variant="labelSmall" style={ui.muted}>
          {item.time}
        </Text>
      </Row>
      <Text variant="titleMedium">{item.title}</Text>
      <Text variant="labelSmall" style={ui.muted}>
        {item.location} • BHOME
      </Text>
      <View style={ui.soft}>
        <Text variant="titleMedium" style={ui.money}>
          {item.amount}
        </Text>
        <Text variant="bodySmall" style={ui.muted}>
          {item.detail}
        </Text>
      </View>
      <View style={ui.wrap}>
        <View style={ui.half}>
          <Action secondary icon="close" onPress={() => setDecision('Từ chối')}>
            Từ chối
          </Action>
        </View>
        <View style={ui.half}>
          <Action icon="check" onPress={() => setDecision('Phê duyệt')}>
            {compact ? 'Duyệt ngay' : 'Phê duyệt'}
          </Action>
        </View>
      </View>
      {!compact && (
        <Button compact onPress={() => unavailable('Xem hồ sơ và chứng từ')}>
          Xem hồ sơ & chứng từ
        </Button>
      )}
      <Portal>
        <Dialog visible={!!decision} onDismiss={() => setDecision('')}>
          <Dialog.Title>{decision} yêu cầu</Dialog.Title>
          <Dialog.Content>
            <Text>{item.title}</Text>
            <Text style={{ marginVertical: 12 }}>
              Màn hình mẫu. Quyết định cần API và kiểm tra quyền Owner.
            </Text>
            {decision === 'Từ chối' && (
              <TextInput
                mode="outlined"
                label="Lý do từ chối"
                value={reason}
                onChangeText={setReason}
                multiline
              />
            )}
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setDecision('')}>Quay lại</Button>
            <Button
              disabled={decision === 'Từ chối' && !reason.trim()}
              onPress={() => {
                setDecision('');
                unavailable(`${decision} yêu cầu`);
              }}
            >
              Tiếp tục
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </Box>
  );
}
export function OwnerHome() {
  const { go, unavailable } = useWorkspace();
  const [month, setMonth] = useState('Tháng 10/2024');
  return (
    <>
      <Heading
        title="Chào anh Tuấn Dũng"
        detail="Hệ thống hoạt động ổn định • Cập nhật lúc 08:30"
      />
      <Filters options={['Tháng 10/2024', 'Tháng 09/2024']} selected={month} onChange={setMonth} />
      {month === 'Tháng 09/2024' ? (
        <Box>
          <Text>Chưa có dữ liệu mẫu cho kỳ đã chọn.</Text>
        </Box>
      ) : (
        <View style={ui.wrap}>
          <Metric
            label="Thực thu tháng 10"
            value="486.500.000đ"
            detail="↗ +8,4% so tháng trước"
            icon="cash-multiple"
          />
          <Metric
            label="Công nợ tồn"
            value="34.200.000đ"
            detail="8 phòng chậm nộp"
            icon="receipt-text-outline"
          />
          <Metric
            label="Tỷ lệ lấp đầy"
            value="94,5%"
            detail="121/128 • Còn 7 phòng trống"
            icon="chart-donut"
            progress={0.945}
          />
          <Metric
            label="Vận hành cần xử lý"
            value="3"
            detail="phê duyệt khẩn • 2 cảnh báo"
            icon="clipboard-clock-outline"
            danger
          />
        </View>
      )}
      <Box>
        <Heading title="THAO TÁC NHANH" detail="Tiện ích quản trị" />
        <QuickActions
          items={[
            {
              label: 'Gửi tin tòa',
              icon: 'bullhorn-outline',
              onPress: () => unavailable('Gửi thông báo tòa nhà'),
            },
            {
              label: 'Xuất thu chi',
              icon: 'download-circle-outline',
              onPress: () => unavailable('Xuất báo cáo thu chi'),
            },
            { label: 'Phòng trống', icon: 'door-open', onPress: () => go('operations') },
            {
              label: 'Gọi quản lý',
              icon: 'headset',
              onPress: () => unavailable('Liên hệ quản lý'),
            },
          ]}
        />
      </Box>
      <Heading title="Cần phê duyệt" action="Xem tất cả ›" onPress={() => go('approvals')} />
      {[sampleApprovals[2], sampleApprovals[1], sampleApprovals[0]].map((item) => (
        <ApprovalCard key={item.id} item={item} compact />
      ))}
      <Heading title="Cảnh báo vận hành" detail="3 nội dung quan trọng" />
      <Box>
        <InfoRow
          icon="lightning-bolt-outline"
          title="Quá hạn tiền điện tòa B"
          detail="Hóa đơn 14.850.000 đ • Còn 2 ngày"
          onPress={() => go('operations')}
        />
        <InfoRow
          icon="calendar-alert"
          title="5 hợp đồng sắp hết hạn"
          detail="Đống Đa & Cầu Giấy • Trong 15 ngày"
          onPress={() => go('operations')}
        />
        <InfoRow
          icon="speedometer"
          title="Kỳ chốt số điện nước tháng 10"
          detail="85% (109/128) • 19 phòng còn lại"
          onPress={() => go('operations')}
        />
      </Box>
      <Heading
        title="Hiệu suất từng cơ sở"
        detail="Doanh thu & tỷ lệ lấp đầy tháng 10"
        action="Chi tiết"
        onPress={() => go('operations')}
      />
      {[
        'Cầu Giấy|36/36 phòng • 100% lấp đầy|152,0 tr',
        'Đống Đa|42/45 phòng • 93% lấp đầy|168,0 tr',
        'Thanh Xuân|28/30 phòng • 93% lấp đầy|105,0 tr',
        'Hà Đông|15/17 phòng • 88% lấp đầy|61,5 tr',
      ].map((line) => {
        const [name, detail, amount] = line.split('|');
        return (
          <Box key={name}>
            <Row spread>
              <View style={ui.grow}>
                <Text variant="titleMedium">BHOME {name}</Text>
                <Text variant="labelSmall" style={ui.muted}>
                  {detail}
                </Text>
              </View>
              <Text style={ui.money}>{amount}</Text>
            </Row>
          </Box>
        );
      })}
      <Box style={{ backgroundColor: c.tint }}>
        <InfoRow
          icon="shield-check-outline"
          title="An ninh & Phòng cháy chữa cháy"
          detail="5/5 cơ sở đã kiểm tra định kỳ Q3"
          onPress={() => unavailable('Xem biên bản an toàn')}
        />
      </Box>
    </>
  );
}
export function ApprovalCenter() {
  const { unavailable } = useWorkspace();
  const [category, setCategory] = useState('Tất cả');
  const [location, setLocation] = useState('Tất cả cơ sở');
  const items = sampleApprovals.filter(
    (item) =>
      (category === 'Tất cả' || item.category === category) &&
      (location === 'Tất cả cơ sở' || item.location === location),
  );
  return (
    <>
      <Heading
        title="Trung tâm Phê duyệt"
        detail="5 yêu cầu chờ quyết định • 3 khẩn cấp"
        action="Lịch sử"
        onPress={() => unavailable('Nhật ký phê duyệt')}
      />
      <Filters
        options={['Tất cả cơ sở', 'Cầu Giấy', 'Đống Đa', 'Thanh Xuân', 'Hà Đông']}
        selected={location}
        onChange={setLocation}
      />
      <Box style={{ backgroundColor: c.tint }}>
        <Heading
          title="Phê duyệt hàng loạt"
          detail="Chọn các hồ sơ đã thẩm định"
          action="Bắt đầu"
          onPress={() => unavailable('Phê duyệt hàng loạt')}
        />
      </Box>
      <View style={ui.wrap}>
        <Metric
          label="Dự toán xin duyệt"
          value="14.850.000đ"
          detail="Bảo trì & Mua sắm (2 mục)"
          icon="wallet-outline"
        />
        <Metric
          label="Điều chỉnh giảm trừ"
          value="-350.000đ"
          detail="Hóa đơn sự cố nước T10"
          icon="receipt-text-minus-outline"
        />
      </View>
      <Filters
        options={['Tất cả', 'Hợp đồng', 'Hóa đơn & Tiền tệ', 'Sửa chữa & Vật tư', 'Khác']}
        selected={category}
        onChange={setCategory}
      />
      {items.map((item) => (
        <ApprovalCard key={item.id} item={item} />
      ))}
      {!items.length && (
        <Box>
          <Text>Không có yêu cầu phù hợp bộ lọc.</Text>
        </Box>
      )}
    </>
  );
}
export function Operations() {
  const { unavailable } = useWorkspace();
  const [location, setLocation] = useState('Tất cả cơ sở');
  const [filter, setFilter] = useState('Tất cả');
  const at = (name: string) => location === 'Tất cả cơ sở' || location === name;
  return (
    <>
      <Pill tone="green">BHOME Operations • Dữ liệu minh họa</Pill>
      <Heading title="Giám sát vận hành" detail="Tổng hợp công việc, sự cố và hợp đồng" />
      <Filters
        options={['Tất cả cơ sở', 'Cầu Giấy', 'Đống Đa', 'Thanh Xuân', 'Hà Đông']}
        selected={location}
        onChange={setLocation}
      />
      <View style={ui.wrap}>
        <Metric
          label="Sự cố đang mở"
          value={location === 'Tất cả cơ sở' ? '03' : at('Đống Đa') ? '01' : '00'}
          detail="Trong phạm vi mẫu đã chọn"
          icon="wrench-outline"
          danger
        />
        <Metric
          label="Việc nhân viên"
          value="14/18"
          detail="78% hoàn thành • Toàn chuỗi mẫu"
          icon="clipboard-check-outline"
          progress={0.78}
        />
        <Metric
          label="Hạn HĐ (≤30 ngày)"
          value="05"
          detail="3 phòng chốt tái ký • Toàn chuỗi mẫu"
          icon="timer-outline"
        />
        <Metric
          label="Chốt điện nước"
          value="109/128"
          detail="85% • Toàn chuỗi mẫu"
          icon="speedometer"
          progress={0.85}
        />
      </View>
      <Filters
        options={['Tất cả', 'Sự cố & Sửa chữa', 'Công việc Staff', 'Hạn HĐ & Cọc', 'Điện nước']}
        selected={filter}
        onChange={setFilter}
      />
      {(filter === 'Tất cả' || filter === 'Sự cố & Sửa chữa') && (
        <>
          <Heading title="Sự cố & Kỹ thuật cần lưu ý" />
          {at('Đống Đa') ? (
            <Box>
              <Row spread>
                <Pill tone="red">KHẨN CẤP</Pill>
                <Text variant="labelSmall">Tòa B - Đống Đa</Text>
              </Row>
              <Text variant="titleLarge">Tụt áp máy bơm nước tầng 4 – 6</Text>
              <Pill tone="green">Đã duyệt kinh phí</Pill>
              <Text variant="bodySmall">
                Đang thay rơ-le áp suất tự ngắt. Nguồn nước phụ tạm thời ổn định.
              </Text>
              <Action secondary icon="eye-outline" onPress={() => unavailable('Xem tiến độ sự cố')}>
                Chi tiết tiến độ
              </Action>
            </Box>
          ) : (
            <Box>
              <Text>Không có sự cố mẫu tại cơ sở đã chọn.</Text>
            </Box>
          )}
        </>
      )}
      {(filter === 'Tất cả' || filter === 'Công việc Staff') && (
        <>
          <Heading title="Tiến độ ca trực nhân viên" detail="Trong cơ sở đã chọn" />
          <Box>
            <InfoRow
              icon="account-hard-hat-outline"
              title="Kỹ thuật viên trực ca"
              detail="Hoàn thành 4/5 đầu việc định kỳ"
              onPress={() => unavailable('Xem nhật ký cơ sở')}
            />
            <ProgressBar progress={0.8} color={c.blue} />
          </Box>
        </>
      )}
      {(filter === 'Tất cả' || filter === 'Hạn HĐ & Cọc') && (
        <>
          <Heading title="Hạn HĐ & Rủi ro trống phòng" />
          <Box>
            <InfoRow
              icon="file-document-outline"
              title="P.301 - BHOME Cầu Giấy"
              detail="Đã đồng ý gia hạn • Hết hạn 25/11 (mẫu)"
              onPress={() => unavailable('Xem hợp đồng')}
            />
            <InfoRow
              icon="calendar-alert"
              title="P.102 - BHOME Thanh Xuân"
              detail="Chờ phản hồi gia hạn"
              onPress={() => unavailable('Gửi nhắc gia hạn')}
            />
          </Box>
        </>
      )}
      {(filter === 'Tất cả' || filter === 'Điện nước') && (
        <>
          <Heading title="Chốt điện nước & Công nợ" />
          <Box>
            <Icon source="water-outline" size={26} color={c.blue} />
            <Text variant="titleMedium">P.502 • Cần kiểm tra chỉ số nước</Text>
            <Text variant="bodySmall">Số liệu mẫu cần Staff kiểm tra và xác nhận trực tiếp.</Text>
            <Action secondary onPress={() => unavailable('Tạo lệnh kiểm tra')}>
              Lệnh kiểm tra phòng
            </Action>
          </Box>
        </>
      )}
      <Box>
        <InfoRow
          icon="fire-extinguisher"
          title="Kiểm định PCCC tuần 4"
          detail="Xem hồ sơ kiểm tra an toàn cơ sở"
          onPress={() => unavailable('Xem biên bản PCCC')}
        />
      </Box>
    </>
  );
}
