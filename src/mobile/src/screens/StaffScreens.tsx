/* eslint-disable @typescript-eslint/no-require-imports -- Metro requires static asset paths. */
import React, { useState } from 'react';
import { Image, View } from 'react-native';
import { router } from 'expo-router';
import { Button, Icon, ProgressBar, Searchbar, Text, TextInput } from 'react-native-paper';
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
import { sampleWorkOrders, type WorkOrderItem } from '../services/workspaceData';
import { colors as c } from '../theme/theme';

function WorkCard({ item }: { item: WorkOrderItem }) {
  const { go } = useWorkspace();
  return (
    <Box>
      <Row spread>
        <Pill
          tone={item.id === 'CV-1042' ? 'red' : item.status === 'Hoàn thành' ? 'green' : 'blue'}
        >
          {item.id === 'CV-1042' ? 'KHẨN CẤP' : item.status}
        </Pill>
        <Text variant="labelSmall" style={item.id === 'CV-1042' ? ui.red : ui.muted}>
          {item.time}
        </Text>
      </Row>
      <Text variant="titleLarge">{item.title}</Text>
      <Text variant="labelSmall" style={ui.muted}>
        {item.room} • #{item.id}
      </Text>
      <View style={ui.soft}>
        <Text variant="bodySmall">{item.detail}</Text>
      </View>
      <View style={ui.wrap}>
        <View style={ui.half}>
          <Action
            secondary
            icon="camera-outline"
            onPress={() => go('task-detail', { taskId: item.id })}
          >
            Nghiệm thu ảnh
          </Action>
        </View>
        <View style={ui.half}>
          <Action icon="progress-check" onPress={() => go('task-detail', { taskId: item.id })}>
            Cập nhật tiến độ
          </Action>
        </View>
      </View>
    </Box>
  );
}
export function StaffHome() {
  const { go, unavailable } = useWorkspace();
  return (
    <>
      <Box>
        <Row spread>
          <Pill>KỸ THUẬT VIÊN VẬN HÀNH</Pill>
          <Pill tone="neutral">Mã NV: BH-882</Pill>
        </Row>
        <Text variant="headlineSmall">Chào Trần Văn Hùng</Text>
        <Text variant="bodySmall">▦ BHOME Đống Đa - Tòa B (32 Phòng)</Text>
        <View style={ui.soft}>
          <Row spread>
            <Text variant="labelMedium">● Ca sáng (07:30 - 16:30)</Text>
            <Pill tone="green">Đang trực ca</Pill>
          </Row>
          <Text variant="bodySmall">Điểm danh lúc: 07:28 • Dữ liệu mẫu</Text>
          <View style={ui.wrap}>
            <View style={ui.half}>
              <Action secondary onPress={() => go('shifts')}>
                Lịch ca
              </Action>
            </View>
            <View style={ui.half}>
              <Action onPress={() => go('work-orders')}>Xem công việc</Action>
            </View>
          </View>
        </View>
      </Box>
      <Heading title="Tiêu điểm trong ca" detail="Hôm nay • Dữ liệu mẫu" />
      <View style={ui.wrap}>
        <Metric
          label="Tiến độ việc"
          value="4/6 việc"
          detail="67% Hoàn thành"
          icon="check-circle-outline"
          progress={0.67}
        />
        <Metric
          label="Khẩn cấp"
          value="01 sự cố"
          detail="Bơm tăng áp T4–6"
          icon="alert-outline"
          danger
        />
        <Metric
          label="Điện nước T10"
          value="28/32 phòng"
          detail="Còn 4 phòng cần chốt"
          icon="water-check-outline"
        />
        <Metric
          label="Bàn giao phòng"
          value="01 cuộc hẹn"
          detail="14:30 • P.302"
          icon="handshake-outline"
        />
      </View>
      <Box>
        <Heading title="Tác nghiệp nhanh" detail="Thao tác tại hiện trường" />
        <QuickActions
          items={[
            { label: 'Quét số OCR', icon: 'text-recognition', onPress: () => go('meter-reading') },
            {
              label: 'Báo sự cố',
              icon: 'alert-circle-outline',
              onPress: () => go('report-incident'),
            },
            {
              label: 'Bàn giao',
              icon: 'key-outline',
              onPress: () => go('move-in'),
            },
            {
              label: 'Tra cứu phòng',
              icon: 'door-open',
              onPress: () => go('rooms'),
            },
          ]}
        />
      </Box>
      <Box>
        <Heading title="Hồ sơ & Tác nghiệp" />
        <InfoRow
          icon="account-plus-outline"
          title="Tiếp nhận Tenant & Người cùng ở"
          detail="Tạo hồ sơ, chụp CCCD, kiểm tra OCR"
          onPress={() => go('onboarding')}
        />
        <InfoRow
          icon="file-document-edit-outline"
          title="Chuẩn bị hợp đồng"
          detail="Giữ chỗ / Thuê chính → Owner duyệt"
          onPress={() => go('prepare-contract')}
        />
        <InfoRow
          icon="clipboard-check-outline"
          title="Kiểm tra trả phòng"
          detail="Hiện trạng, thiết bị & chỉ số cuối"
          onPress={() => go('move-out')}
        />
        <InfoRow
          icon="cash-clock"
          title="Theo dõi công nợ được giao"
          detail="Liên hệ, ghi nhận vướng mắc"
          onPress={() => go('debt-follow-up')}
        />
        <InfoRow icon="file-sign" title="Trạng thái ký hợp đồng" onPress={() => go('signing')} />
      </Box>
      <Heading title="Công việc ưu tiên" action="Xem tất cả ›" onPress={() => go('work-orders')} />
      <WorkCard item={sampleWorkOrders.find((item) => item.id === 'CV-1042')!} />
      <Box>
        <Pill>ĐẾN HẠN • CHƯA LÀM</Pill>
        <Text variant="titleLarge">Ghi chỉ số nước định kỳ: P.501, P.502, P.503, P.504</Text>
        <Text variant="bodySmall" style={ui.muted}>
          Hộp kỹ thuật hành lang tầng 5. Cần chốt trước 15:00 để lập hóa đơn định kỳ.
        </Text>
        <Action icon="camera-outline" onPress={() => go('meter-reading')}>
          Mở Camera OCR (4 phòng)
        </Action>
      </Box>
      <Box>
        <Pill>14:30 HÔM NAY</Pill>
        <Text variant="titleLarge">Đón khách & bàn giao P.302</Text>
        <Text variant="bodySmall">Khách thuê mẫu • Kiểm tra thiết bị trước bàn giao</Text>
        <Action secondary onPress={() => go('move-in')}>
          Biên bản bàn giao
        </Action>
      </Box>
      <Box>
        <Heading
          title="Ghi chú ca & An toàn tòa nhà"
          action="Chỉnh sửa"
          onPress={() => unavailable('Ghi chú ca trực')}
        />
        <View style={ui.soft}>
          <Text variant="bodySmall">
            Ghi chú quản lý (08:15): Hệ thống chiếu sáng hành lang T3 đã thay 2 bóng LED. Áp lực
            nước tầng thượng đã ổn định tạm thời.
          </Text>
        </View>
        <InfoRow
          icon="fire-extinguisher"
          title="An toàn PCCC Tòa B"
          detail="Bình chữa cháy & vòi cứu hỏa • Đạt kiểm tra"
        />
      </Box>
    </>
  );
}
export function WorkOrders() {
  const { go } = useWorkspace();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('Tất cả');
  const [category, setCategory] = useState('Tất cả loại');
  const items = sampleWorkOrders.filter(
    (item) =>
      (status === 'Tất cả' || item.status === status) &&
      (category === 'Tất cả loại' || item.category === category) &&
      `${item.title} ${item.room} ${item.id}`
        .toLocaleLowerCase('vi')
        .includes(query.toLocaleLowerCase('vi')),
  );
  return (
    <>
      <Pill>Bộ phận kỹ thuật & Vận hành</Pill>
      <Heading title="Phiếu công việc & Kỹ thuật" detail="Ca sáng (07:00 - 15:30) • Tòa B" />
      <Searchbar
        placeholder="Tìm mã việc, phòng, nội dung…"
        value={query}
        onChangeText={setQuery}
        style={{ backgroundColor: c.white, borderRadius: 10 }}
      />
      <Filters
        options={['Tất cả', 'Cần làm', 'Đang xử lý', 'Chờ vật tư', 'Hoàn thành']}
        selected={status}
        onChange={setStatus}
      />
      <Filters
        options={['Tất cả loại', 'Điện nước', 'Bảo dưỡng', 'Bàn giao', 'Công việc chung']}
        selected={category}
        onChange={setCategory}
      />
      <Heading title="Danh sách trong ca" detail={`${items.length} việc phù hợp`} />
      {items.map((item) => (
        <WorkCard key={item.id} item={item} />
      ))}
      {!items.length && (
        <Box>
          <Icon source="clipboard-search-outline" size={36} color={c.muted} />
          <Text>Không có công việc phù hợp.</Text>
          <Button
            onPress={() => {
              setQuery('');
              setStatus('Tất cả');
              setCategory('Tất cả loại');
            }}
          >
            Xóa bộ lọc
          </Button>
        </Box>
      )}
      <Action icon="calendar-month-outline" onPress={() => go('shifts')}>
        Xem lịch ca được phân công
      </Action>
    </>
  );
}
export function MeterReading() {
  const { preview, unavailable } = useWorkspace();
  const [filter, setFilter] = useState('Chưa ghi (4)');
  const [reading, setReading] = useState('1525.8');
  const [manual, setManual] = useState(false);
  const [error, setError] = useState('');
  return (
    <>
      <Pill>Kỳ đối soát định kỳ</Pill>
      <Heading title="Chốt số Điện Nước T10/2024" detail="BHOME Đống Đa - Tòa B (32 Phòng)" />
      <Box>
        <Row spread>
          <Text variant="titleMedium">Tiến độ chốt tòa B</Text>
          <Text variant="titleMedium" style={ui.blue}>
            28/32 phòng (88%)
          </Text>
        </Row>
        <ProgressBar progress={0.88} color={c.blue} />
        <Row spread>
          <Pill tone="green">28 đã xác nhận</Pill>
          <Pill tone="amber">4 cần ghi</Pill>
        </Row>
      </Box>
      <Filters
        options={['Tất cả (32)', 'Chưa ghi (4)', 'Cần kiểm tra (2)', 'Đã chốt (26)']}
        selected={filter}
        onChange={setFilter}
      />
      <Box>
        <Heading title="Camera OCR Công tơ" detail="Nhận dạng là gợi ý • Staff cần đối chiếu ảnh" />
        <View style={{ borderRadius: 12, overflow: 'hidden', backgroundColor: c.navy }}>
          <Image
            source={require('../../assets/stitch/ghi_ch_s_i_n_n_c_ai_ocr_staff_meter_reading-0.jpg')}
            style={{ width: '100%', height: 190, opacity: 0.7 }}
            accessibilityLabel="Ảnh công tơ mẫu Stitch"
          />
          <View
            style={{
              position: 'absolute',
              top: 60,
              left: 28,
              right: 28,
              padding: 16,
              borderColor: '#94f5cf',
              borderWidth: 2,
              borderRadius: 8,
            }}
          >
            <Text variant="headlineMedium" style={[ui.white, ui.money, { textAlign: 'center' }]}>
              01525.8 kWh
            </Text>
          </View>
          <Text variant="labelSmall" style={[ui.white, { padding: 12 }]}>
            Ảnh minh họa • Camera chưa mở
          </Text>
        </View>
        {manual && (
          <TextInput
            label="Chỉ số đề xuất (kWh)"
            value={reading}
            onChangeText={setReading}
            keyboardType="decimal-pad"
            mode="outlined"
            error={!!error}
          />
        )}
        {!!error && <Text style={ui.red}>{error}</Text>}
        <View style={ui.wrap}>
          <View style={ui.half}>
            <Action secondary icon="pencil-outline" onPress={() => setManual(!manual)}>
              Sửa tay / Chụp lại
            </Action>
          </View>
          <View style={ui.half}>
            <Action
              icon="check-all"
              onPress={() => {
                const number = Number(reading.replace(',', '.'));
                if (!reading.trim() || !Number.isFinite(number) || number < 1420)
                  setError('Chỉ số phải hợp lệ và không nhỏ hơn số cũ 1.420.');
                else {
                  setError('');
                  unavailable('Xác nhận và lưu chỉ số');
                }
              }}
            >
              Lưu chỉ số
            </Action>
          </View>
        </View>
        <Action
          icon="camera-outline"
          onPress={() =>
            preview
              ? unavailable('Camera OCR cần tài khoản Staff và tác vụ thật; đăng nhập để sử dụng')
              : router.push('/capture')
          }
        >
          Bật Camera Quét OCR
        </Action>
      </Box>
      <Heading
        title={
          filter === 'Đã chốt (26)'
            ? 'Đã hoàn tất & xác nhận'
            : filter === 'Cần kiểm tra (2)'
              ? 'Cần kiểm tra trực tiếp'
              : 'CẦN GHI NGAY'
        }
        detail="Hạn trước 15:00"
      />
      {(filter === 'Đã chốt (26)'
        ? ['301', '302']
        : filter === 'Cần kiểm tra (2)'
          ? ['502', '504']
          : ['501', '502', '503', '504']
      ).map((room) => (
        <Box key={room}>
          <Row spread>
            <Text variant="headlineSmall">{room}</Text>
            <Pill tone={filter === 'Đã chốt (26)' ? 'green' : 'amber'}>
              {filter === 'Đã chốt (26)' ? 'Đã xác nhận' : 'Chưa chốt'}
            </Pill>
          </Row>
          <Text variant="bodySmall" style={ui.muted}>
            Tầng {room[0]} • Người thuê mẫu • Cơ sở được phân công
          </Text>
          <View style={ui.soft}>
            <Row spread>
              <Text variant="bodySmall">Điện kỳ trước</Text>
              <Text style={ui.money}>1.420 kWh</Text>
            </Row>
            <Row spread>
              <Text variant="bodySmall">Nước kỳ trước</Text>
              <Text style={ui.money}>210 m³</Text>
            </Row>
          </View>
          <Action
            secondary
            icon="camera-outline"
            onPress={() => unavailable(`Chụp OCR phòng ${room} cần tác vụ thật`)}
          >
            {filter === 'Đã chốt (26)' ? 'Xem ảnh bằng chứng' : 'Chụp OCR Điện / Nước'}
          </Action>
        </Box>
      ))}
      <Box>
        <Heading title="Tiện ích Vận hành & Định mức" />
        <InfoRow
          icon="file-export-outline"
          title="Xuất dữ liệu sang Kế toán"
          detail="Cần API xuất dữ liệu đã xác nhận"
          onPress={() => unavailable('Xuất dữ liệu')}
        />
        <Text variant="bodySmall" style={ui.muted}>
          Chế độ ghi số offline và IoT chưa được hỗ trợ.
        </Text>
      </Box>
    </>
  );
}
