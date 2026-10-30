/* eslint-disable @typescript-eslint/no-require-imports -- Metro requires static asset paths. */
import React, { useState } from 'react';
import { View } from 'react-native';
import {
  Button,
  Dialog,
  Icon,
  Portal,
  ProgressBar,
  Text,
  TextInput,
  TouchableRipple,
} from 'react-native-paper';
import {
  Action,
  Box,
  Filters,
  Heading,
  InfoRow,
  Metric,
  Photo,
  Pill,
  Row,
  ui,
} from '../components/WorkspaceKit';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { invoiceLines, vnd } from '../services/workspaceData';
import { colors as c } from '../theme/theme';

function InvoiceBreakdown({ detailed = false }: { detailed?: boolean }) {
  const { unavailable } = useWorkspace();
  return (
    <>
      {invoiceLines.map((line) => (
        <View key={line.title} style={[ui.soft, { padding: 10 }]}>
          <Row spread>
            <Icon source={line.icon} size={18} color={c.blue} />
            <View style={ui.grow}>
              <Text variant="bodySmall">{line.title}</Text>
              {detailed && (
                <Text variant="labelSmall" style={ui.muted}>
                  {line.detail}
                </Text>
              )}
            </View>
            <Text variant="labelMedium" style={ui.money}>
              {vnd(line.amount)}
            </Text>
          </Row>
          {detailed && ['water-outline', 'lightning-bolt-outline'].includes(line.icon) && (
            <Button
              compact
              icon="text-recognition"
              onPress={() => unavailable('Xem ảnh chỉ số đã xác nhận')}
            >
              Xem ảnh OCR
            </Button>
          )}
        </View>
      ))}
    </>
  );
}
export function TenantHome() {
  const { go, unavailable } = useWorkspace();
  return (
    <>
      <Box style={ui.dark}>
        <Text variant="labelSmall" style={ui.white}>
          CĂN HỘ CỦA BẠN
        </Text>
        <Text variant="headlineSmall" style={ui.white}>
          Chào Hoàng Tuấn Anh
        </Text>
        <Text variant="bodySmall" style={ui.white}>
          Phòng 301 • Tòa BHOME Cầu Giấy (Tầng 3)
        </Text>
        <Pill tone="green">Hợp đồng mẫu • Đang hiệu lực</Pill>
        <Pill>Đã xác thực CCCD • Mẫu</Pill>
        <View style={{ backgroundColor: '#172b4d', padding: 12, borderRadius: 8 }}>
          <Row spread>
            <Icon source="lock-outline" size={24} color="#94f5cf" />
            <View style={ui.grow}>
              <Text variant="labelMedium" style={ui.white}>
                Khóa thông minh
              </Text>
              <Text variant="labelSmall" style={ui.white}>
                Chưa kết nối thiết bị
              </Text>
            </View>
            <Button
              mode="contained-tonal"
              compact
              onPress={() => unavailable('Quản lý khóa thông minh chưa thuộc phạm vi MVP')}
            >
              Chi tiết
            </Button>
          </Row>
        </View>
      </Box>
      <Box>
        <Row spread>
          <View style={ui.grow}>
            <Text variant="labelSmall" style={ui.muted}>
              Thanh toán định kỳ
            </Text>
            <Text variant="titleLarge">Hóa đơn kỳ Tháng 10/2024</Text>
          </View>
          <Pill tone="amber">Chờ thanh toán</Pill>
        </Row>
        <View style={ui.soft}>
          <Text variant="labelSmall">Tổng số tiền cần thanh toán</Text>
          <Text variant="headlineMedium" style={[ui.blue, ui.money]}>
            5.420.000 <Text variant="bodyMedium">VNĐ</Text>
          </Text>
          <Text variant="labelSmall" style={ui.muted}>
            Thông tin mẫu • Chưa phát sinh yêu cầu thanh toán
          </Text>
        </View>
        <Text variant="labelSmall" style={ui.muted}>
          CHI TIẾT KHOẢN THU
        </Text>
        <InvoiceBreakdown />
        <Action icon="qrcode-scan" onPress={() => go('invoice')}>
          Thanh toán ngay qua VietQR
        </Action>
        <Action secondary icon="receipt-text-outline" onPress={() => go('invoice')}>
          Xem chi tiết & sao kê hóa đơn
        </Action>
      </Box>
      <Heading title="Tiện ích cư dân" detail="BHOME Services" />
      <View style={ui.wrap}>
        {[
          {
            icon: 'wrench-outline',
            title: 'Báo sự cố',
            detail: 'Sửa điện, nước, nội thất…',
            action: () => go('incidents'),
          },
          {
            icon: 'qrcode-scan',
            title: 'Thanh toán VietQR',
            detail: 'Xem thông tin khoản thu',
            action: () => go('invoice'),
          },
          {
            icon: 'file-document-outline',
            title: 'Gia hạn hợp đồng',
            detail: 'Hợp đồng & phụ lục',
            action: () => go('contract'),
          },
          {
            icon: 'card-account-details-outline',
            title: 'Tạm trú VNeID',
            detail: 'Tự đăng ký ngoài BHOME',
            action: () => go('residence'),
          },
        ].map((item) => (
          <TouchableRipple
            key={item.title}
            onPress={item.action}
            style={[ui.card, ui.half]}
            accessibilityRole="button"
          >
            <View style={{ gap: 10 }}>
              <Icon source={item.icon} size={24} color={c.blue} />
              <Text variant="titleMedium">{item.title}</Text>
              <Text variant="labelSmall" style={ui.muted}>
                {item.detail}
              </Text>
            </View>
          </TouchableRipple>
        ))}
      </View>
      <Box>
        <InfoRow
          icon="history"
          title="Lịch sử hóa đơn & Thanh toán"
          onPress={() => go('billing-history')}
        />
        <InfoRow
          icon="receipt-text-edit-outline"
          title="Yêu cầu điều chỉnh hóa đơn"
          onPress={() => go('adjustment')}
        />
        <InfoRow icon="file-sign" title="Trạng thái ký hợp đồng" onPress={() => go('signing')} />
      </Box>
      <Heading title="Theo dõi xử lý sự cố" action="1 đang mở" onPress={() => go('incidents')} />
      <Box>
        <Pill>Mã #SC-3012 • Phòng tắm</Pill>
        <Text variant="titleMedium">Thay vòi xịt vệ sinh phòng tắm</Text>
        <InfoRow
          icon="account-hard-hat-outline"
          title="KTV: Trần Văn Hùng"
          detail="Lịch hẹn: 14:00 hôm nay (26/10)"
          onPress={() => go('incidents')}
        />
        <ProgressBar progress={0.75} color={c.blue} />
        <Row spread>
          <Text variant="labelSmall">Tiếp nhận</Text>
          <Text variant="labelSmall">Phân công</Text>
          <Text variant="labelSmall" style={ui.blue}>
            Đang sửa
          </Text>
          <Text variant="labelSmall">Nghiệm thu</Text>
        </Row>
      </Box>
      <Heading
        title="Minh bạch điện nước"
        action="Xem ảnh công tơ"
        onPress={() => unavailable('Xem ảnh công tơ')}
      />
      <View style={ui.wrap}>
        <Metric
          label="Điện tiêu thụ T10"
          value="105 kWh"
          detail="1.420 → 1.525 • Staff xác nhận"
          icon="lightning-bolt-outline"
        />
        <Metric
          label="Nước tiêu thụ T10"
          value="7 m³"
          detail="210 → 217 • Staff xác nhận"
          icon="water-outline"
        />
      </View>
      <Heading title="Bảng tin cư dân BHOME" />
      <Box>
        <InfoRow
          icon="elevator-passenger-outline"
          title="Thông báo kỹ thuật"
          detail="Bảo dưỡng định kỳ thang máy & máy phát điện dự phòng"
        />
        <InfoRow
          icon="fire-extinguisher"
          title="An toàn PCCC"
          detail="Kiểm tra hệ thống báo cháy & cửa thoát hiểm Tầng 3"
        />
      </Box>
      <Box style={{ backgroundColor: c.tint }}>
        <Heading title="Hỗ trợ khẩn cấp 24/7" />
        <Text variant="bodySmall">
          Khi có nguy hiểm trực tiếp, liên hệ dịch vụ khẩn cấp công cộng. Thông tin liên hệ BQL cần
          được cung cấp từ cơ sở của bạn.
        </Text>
        <Action secondary icon="headset" onPress={() => unavailable('Liên hệ Ban quản lý')}>
          Liên hệ Ban quản lý
        </Action>
      </Box>
    </>
  );
}
export function TenantInvoice() {
  const { unavailable, go } = useWorkspace();
  const [method, setMethod] = useState('VietQR');
  return (
    <>
      <Pill tone="amber">Chờ thanh toán • Dữ liệu mẫu</Pill>
      <Heading title="Hóa đơn T10/2024" detail="Căn hộ P.301 • BHOME Cầu Giấy • Hạn 05/11/2024" />
      <Filters options={['VietQR', 'Thẻ ATM / Visa']} selected={method} onChange={setMethod} />
      {method === 'VietQR' ? (
        <Box>
          <Row spread>
            <Text variant="titleMedium" style={ui.blue}>
              VietQR • Chuyển khoản ngân hàng
            </Text>
            <Pill>NAPAS 247</Pill>
          </Row>
          <View
            style={{
              alignItems: 'center',
              gap: 12,
              padding: 18,
              backgroundColor: c.soft,
              borderRadius: 12,
            }}
          >
            <Text variant="labelSmall">Tổng số tiền cần thanh toán</Text>
            <Text variant="headlineMedium" style={ui.money}>
              5.420.000 VNĐ
            </Text>
            <View
              style={{
                width: 188,
                height: 188,
                backgroundColor: c.white,
                borderColor: c.border,
                borderWidth: 1,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                gap: 10,
              }}
            >
              <Icon source="qrcode" size={96} color={c.primary} />
              <Text variant="labelSmall">CHƯA CÓ MÃ THANH TOÁN</Text>
            </View>
            <Text variant="bodySmall" style={[ui.muted, { textAlign: 'center' }]}>
              Mã QR thật sẽ được cung cấp từ API. Không chuyển tiền theo dữ liệu minh họa.
            </Text>
          </View>
          <View style={ui.wrap}>
            <View style={ui.half}>
              <Action secondary icon="download-outline" onPress={() => unavailable('Tải mã QR')}>
                Tải mã QR
              </Action>
            </View>
            <View style={ui.half}>
              <Action
                secondary
                icon="share-variant-outline"
                onPress={() => unavailable('Chia sẻ hóa đơn')}
              >
                Chia sẻ hóa đơn
              </Action>
            </View>
          </View>
          <InfoRow
            icon="bank-outline"
            title="Ngân hàng thụ hưởng"
            detail="Chờ thông tin đã xác nhận từ máy chủ"
          />
          <View style={ui.soft}>
            <Text variant="labelSmall">NỘI DUNG CHUYỂN TIỀN (MẪU)</Text>
            <Text variant="titleLarge">BHOME P301 T10</Text>
            <Text variant="labelSmall" style={ui.muted}>
              Chỉ sử dụng nội dung do API cấp cho hóa đơn thật.
            </Text>
          </View>
        </Box>
      ) : (
        <Box>
          <Icon source="credit-card-off-outline" size={36} color={c.muted} />
          <Text>Thanh toán thẻ chưa được hỗ trợ. BHOME hiện hỗ trợ chuyển khoản ngân hàng.</Text>
          <Button onPress={() => setMethod('VietQR')}>Quay lại VietQR</Button>
        </Box>
      )}
      <Action secondary onPress={() => go('billing-history')}>
        Lịch sử hóa đơn & Thanh toán
      </Action>
      <Action secondary onPress={() => go('adjustment')}>
        Yêu cầu điều chỉnh khoản thu
      </Action>
      <Heading title="Chi tiết các khoản thu tháng 10" detail="4 khoản mục" />
      <Box>
        <InvoiceBreakdown detailed />
        <View style={ui.line} />
        <Row spread>
          <Text variant="titleMedium">Tổng tiền thanh toán</Text>
          <Text variant="titleLarge" style={ui.money}>
            {vnd(invoiceLines.reduce((sum, item) => sum + item.amount, 0))}
          </Text>
        </Row>
      </Box>
      <Box>
        <InfoRow
          icon="shield-check-outline"
          title="Giao dịch an toàn & Minh bạch"
          detail="Trạng thái thanh toán chỉ thay đổi sau khi ngân hàng hoặc Owner xác minh."
        />
      </Box>
      <Action
        icon="check-circle-outline"
        onPress={() => unavailable('Kiểm tra đối soát thanh toán')}
      >
        Đã chuyển khoản • Kiểm tra gạch nợ
      </Action>
    </>
  );
}
export function TenantContract() {
  const { go, unavailable } = useWorkspace();
  return (
    <>
      <Pill tone="green">Hợp đồng mẫu • Đang hiệu lực</Pill>
      <Heading title="Hợp đồng & Bàn giao" detail="Phòng 301 • Tòa BHOME Cầu Giấy" />
      <Filters
        options={['Hợp đồng điện tử', 'Biên bản kiểm kê']}
        selected="Hợp đồng điện tử"
        onChange={(value) => {
          if (value === 'Biên bản kiểm kê') go('checklist');
        }}
      />
      <Box>
        <Row spread>
          <Text variant="titleLarge">Hợp đồng thuê căn hộ</Text>
          <Pill>2 Năm</Pill>
        </Row>
        <Text variant="labelSmall" style={ui.muted}>
          #HD-2023-301B • Hồ sơ minh họa
        </Text>
        <View style={ui.soft}>
          <Row spread>
            <View>
              <Text variant="labelSmall" style={ui.muted}>
                Bắt đầu thuê
              </Text>
              <Text variant="titleMedium">25/11/2023</Text>
            </View>
            <Icon source="arrow-right" size={20} color={c.muted} />
            <View>
              <Text variant="labelSmall" style={ui.muted}>
                Hạn kết thúc
              </Text>
              <Text variant="titleMedium">25/11/2025</Text>
            </View>
          </Row>
          <ProgressBar progress={0.46} color={c.blue} />
          <Text variant="labelSmall" style={ui.muted}>
            46% thời hạn • Số liệu theo bản thiết kế
          </Text>
        </View>
        <InfoRow
          icon="office-building-outline"
          title="Bên cho thuê (Lessor)"
          detail="CÔNG TY TNHH BHOME VIỆT NAM • Minh họa"
        />
        <InfoRow
          icon="account-check-outline"
          title="Bên thuê (Tenant)"
          detail="Hoàng Tuấn Anh • CCCD: ************ (mẫu)"
        />
        <View style={ui.wrap}>
          <Box style={[ui.half, { backgroundColor: c.soft }]}>
            <Text variant="labelSmall">Giá thuê niêm yết</Text>
            <Text variant="titleLarge" style={ui.money}>
              4.800.000 đ
            </Text>
          </Box>
          <Box style={[ui.half, { backgroundColor: c.soft }]}>
            <Text variant="labelSmall">Tiền cọc an ninh</Text>
            <Text variant="titleLarge" style={ui.money}>
              4.800.000 đ
            </Text>
          </Box>
        </View>
        <Action
          icon="file-pdf-box"
          onPress={() => unavailable('Tải PDF hợp đồng có chữ ký từ nhà cung cấp')}
        >
          Tải PDF Hợp đồng
        </Action>
        <Action secondary icon="calendar-sync-outline" onPress={() => go('contract-request')}>
          Yêu cầu gia hạn / Thay đổi điều khoản
        </Action>
      </Box>
      <Box>
        <Heading
          title="Phụ lục biểu phí dịch vụ"
          detail="Theo hồ sơ mẫu • Không phải biểu phí hiện hành"
        />
        <InfoRow
          icon="lightning-bolt-outline"
          title="Điện sinh hoạt • 3.800 đ/kWh"
          detail="Công tơ riêng, Staff xác nhận chỉ số"
        />
        <InfoRow
          icon="water-outline"
          title="Nước sạch • 30.000 đ/m³"
          detail="Đồng hồ nước tiêu chuẩn"
        />
        <InfoRow
          icon="broom"
          title="Dịch vụ chung • 100.000 đ/tháng"
          detail="Thang máy, gom rác, tạp vụ vệ sinh"
        />
        <InfoRow
          icon="wifi"
          title="Internet Wi-Fi • Miễn phí"
          detail="Thông tin minh họa theo Stitch"
        />
      </Box>
      <Box>
        <Heading title="Nội quy & Quy chuẩn cư trú" />
        <InfoRow
          icon="clock-outline"
          title="Giờ giấc sinh hoạt"
          detail="Tuân thủ nội quy đã được cơ sở ban hành."
        />
        <InfoRow
          icon="recycle"
          title="Phân loại rác"
          detail="Đổ rác đúng khu vực thu gom của cơ sở."
        />
        <InfoRow
          icon="smoking-off"
          title="Cấm hút thuốc"
          detail="Tại hành lang và khu vực chung."
        />
        <InfoRow
          icon="card-account-details-outline"
          title="Tạm trú VNeID"
          detail="Cư dân tự đăng ký qua kênh chính thức bên ngoài BHOME. Owner cung cấp thông tin chỗ ở."
        />
      </Box>
      <Box>
        <Heading title="Biên bản nhận phòng điện tử" detail="Kiểm kê ngày vào ở (25/11/2023)" />
        <InfoRow
          icon="clipboard-check-outline"
          title="6/6 nhóm trang thiết bị"
          detail="Xem hiện trạng, ảnh và xác nhận bàn giao"
          onPress={() => go('checklist')}
        />
        <Text variant="bodySmall" style={ui.muted}>
          Chữ ký và chứng cứ xác thực cần được lấy từ nhà cung cấp ký điện tử; mẫu không phải chứng
          từ hợp lệ.
        </Text>
      </Box>
    </>
  );
}
const equipment = [
  {
    title: 'Điều hòa Daikin Inverter 12.000 BTU',
    area: 'Phòng khách & Ngủ',
    detail: 'Mới 98%, làm mát tốt, kèm 01 remote. Model FTKF35XVMV.',
    image: require('../../assets/stitch/bi_n_b_n_ki_m_k_b_n_giao_thi_t_b_move_in_checklist-0.jpg'),
  },
  {
    title: 'Tủ lạnh Casper 240L 2 cánh',
    area: 'Khu vực Bếp',
    detail: 'Sạch sẽ, gioăng cao su hít chặt, đầy đủ khay kính.',
    image: require('../../assets/stitch/bi_n_b_n_ki_m_k_b_n_giao_thi_t_b_move_in_checklist-2.jpg'),
  },
  {
    title: 'Bếp từ đôi Sunhouse & Hút mùi',
    area: 'Khu vực Bếp',
    detail: 'Mặt kính không trầy xước, quạt hút mùi hoạt động.',
    image: require('../../assets/stitch/bi_n_b_n_ki_m_k_b_n_giao_thi_t_b_move_in_checklist-3.jpg'),
  },
  {
    title: 'Khóa cửa & Thẻ từ',
    area: 'Công tơ & Khóa',
    detail: 'Đã bàn giao 02 thẻ từ và 02 chìa khóa cơ.',
  },
  {
    title: 'Bình nóng lạnh Ariston 20L & Sen cây',
    area: 'Nhà vệ sinh',
    detail: 'Kiểm tra chống giật ELCB, vòi sen không rò rỉ.',
  },
  {
    title: 'Bàn làm việc & Giường nệm',
    area: 'Phòng khách & Ngủ',
    detail: 'Khung chắc chắn, nệm và ga bảo vệ đầy đủ.',
  },
];
export function MoveInChecklist() {
  const { go, unavailable } = useWorkspace();
  const [area, setArea] = useState('Tất cả');
  return (
    <>
      <Heading title="Hợp đồng & Bàn giao" detail="Phòng 301 • Tòa BHOME Cầu Giấy" />
      <Filters
        options={['Hợp đồng điện tử', 'Biên bản kiểm kê']}
        selected="Biên bản kiểm kê"
        onChange={(value) => {
          if (value === 'Hợp đồng điện tử') go('contract');
        }}
      />
      <Box>
        <Heading title="Hồ sơ bàn giao nhận phòng" detail="Biên bản hiện trạng #BB-2023-301B" />
        <InfoRow
          icon="calendar-check-outline"
          title="Ngày thực hiện • 25/11/2023"
          detail="Staff bàn giao và Tenant cùng kiểm tra"
        />
        <Row spread>
          <Pill tone="green">6 nhóm thiết bị minh họa</Pill>
          <Pill>Hồ sơ mẫu</Pill>
        </Row>
        <Text variant="bodySmall" style={ui.muted}>
          Trạng thái xác nhận và chữ ký chỉ có giá trị khi được kiểm chứng từ API.
        </Text>
      </Box>
      <Heading title="Danh mục khu vực" />
      <Filters
        options={['Tất cả', 'Phòng khách & Ngủ', 'Khu vực Bếp', 'Nhà vệ sinh', 'Công tơ & Khóa']}
        selected={area}
        onChange={setArea}
      />
      <Heading title="Chi tiết kiểm kê & Ảnh bằng chứng" />
      {equipment
        .filter((item) => area === 'Tất cả' || item.area === area)
        .map((item, index) => (
          <Box key={item.title}>
            <Row>
              <Pill>{String(index + 1).padStart(2, '0')}</Pill>
              <Text variant="titleMedium" style={ui.grow}>
                {item.title}
              </Text>
            </Row>
            <Pill tone="green">Hoạt động tốt • Mẫu</Pill>
            <Text variant="bodySmall" style={ui.muted}>
              Hiện trạng bàn giao: {item.detail}
            </Text>
            {item.image && (
              <Photo
                source={item.image}
                label="Ảnh hiện trạng từ thiết kế Stitch"
                onPress={() => unavailable('Xem ảnh nghiệm thu gốc')}
              />
            )}
          </Box>
        ))}
      <Box>
        <Heading title="Phát hiện thiết bị hỏng hóc?" />
        <Text variant="bodySmall">
          Gửi mô tả để Ban quản lý kiểm tra và xác định phương án xử lý.
        </Text>
        <Action icon="alert-plus-outline" onPress={() => go('incidents')}>
          Tạo phiếu báo hỏng thiết bị
        </Action>
      </Box>
      <Action icon="download-outline" onPress={() => unavailable('Tải PDF biên bản kiểm kê')}>
        Tải PDF Biên bản kiểm kê
      </Action>
      <Button onPress={() => unavailable('Yêu cầu kiểm tra lại hiện trạng')}>
        Yêu cầu kiểm tra lại hiện trạng
      </Button>
    </>
  );
}
export function TenantIncidents() {
  const { unavailable } = useWorkspace();
  const [create, setCreate] = useState(false);
  const [category, setCategory] = useState('Nước & Vệ sinh');
  const [severity, setSeverity] = useState('Bình thường');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  return (
    <>
      <Heading title="Sự cố & Sửa chữa" detail="Căn hộ P.301 • BHOME Cầu Giấy" />
      <Action icon="plus" onPress={() => setCreate(true)}>
        Tạo báo hỏng
      </Action>
      <Box>
        <Row spread>
          <Pill>#SC-3012 • P.301</Pill>
          <Pill tone="amber">Đang xử lý</Pill>
        </Row>
        <Text variant="headlineSmall">Rò rỉ dây cấp nước vòi xịt vệ sinh</Text>
        <Text variant="labelSmall" style={ui.muted}>
          Tạo lúc 08:15 Sáng nay (26/10) • Mẫu
        </Text>
        <Heading title="Tiến độ xử lý" detail="Bước 3/4" />
        {[
          'Tiếp nhận sự cố|08:20',
          'Phân công kỹ thuật|08:35',
          'Đang thực hiện sửa chữa|Đang diễn ra',
          'Nghiệm thu & Đánh giá|Chờ',
        ].map((step, index) => (
          <Row key={step}>
            <Icon
              source={index < 2 ? 'check-circle' : index === 2 ? 'wrench' : 'circle-outline'}
              color={index < 3 ? c.blue : c.muted}
              size={24}
            />
            <View style={ui.grow}>
              <Text variant="titleMedium">
                {index + 1}. {step.split('|')[0]}
              </Text>
              <Text variant="labelSmall" style={ui.muted}>
                {step.split('|')[1]}
              </Text>
            </View>
          </Row>
        ))}
        <View style={ui.soft}>
          <InfoRow
            icon="account-hard-hat-outline"
            title="Trần Văn Hùng"
            detail="Kỹ thuật viên Tòa B • Cơ điện"
            onPress={() => unavailable('Liên hệ kỹ thuật viên')}
          />
        </View>
        <Heading title="Hình ảnh hiện trường (2 ảnh)" />
        <View style={ui.wrap}>
          <Photo
            source={require('../../assets/stitch/b_o_s_c_theo_d_i_s_a_ch_a_tenant_incident_report-0.jpg')}
            label="Khớp nối vòi xịt"
          />
          <Photo
            source={require('../../assets/stitch/b_o_s_c_theo_d_i_s_a_ch_a_tenant_incident_report-1.jpg')}
            label="Van khóa & đồng hồ"
          />
        </View>
        <Heading title="Nhật ký xử lý chi tiết" />
        <Text variant="bodySmall">
          13:45: Kỹ thuật viên đã đến phòng và mang theo dây cấp thay thế.
        </Text>
        <Text variant="bodySmall">08:35: Owner đã duyệt phương án sửa chữa (mẫu).</Text>
        <Action
          secondary
          icon="note-edit-outline"
          onPress={() => unavailable('Thêm ghi chú vào phiếu')}
        >
          Thêm ghi chú
        </Action>
        <Button textColor={c.red} onPress={() => unavailable('Yêu cầu hủy phiếu sự cố')}>
          Yêu cầu hủy phiếu
        </Button>
      </Box>
      <Box style={{ backgroundColor: c.redSoft }}>
        <Heading title="Hỗ trợ khẩn cấp (SOS)" />
        <Text variant="bodySmall">
          Khi có nguy hiểm trực tiếp, gọi dịch vụ khẩn cấp công cộng trước và thông báo Ban quản lý.
          Không tự thực hiện thao tác gây nguy hiểm.
        </Text>
        <Action icon="phone-outline" onPress={() => unavailable('Liên hệ khẩn cấp của cơ sở')}>
          Liên hệ Ban quản lý
        </Action>
      </Box>
      <Heading title="Lịch sử sự cố đã xong" detail="2 phiếu" />
      <Box>
        <InfoRow
          icon="check-circle-outline"
          title="Thay bóng đèn LED ban công"
          detail="Hoàn tất: 15/10/2024 • Mẫu"
          onPress={() => unavailable('Chi tiết phiếu đã hoàn tất')}
        />
        <InfoRow
          icon="check-circle-outline"
          title="Bảo dưỡng điều hòa phòng ngủ"
          detail="Hoàn tất: 02/09/2024 • Mẫu"
          onPress={() => unavailable('Chi tiết phiếu đã hoàn tất')}
        />
      </Box>
      <Portal>
        <Dialog visible={create} onDismiss={() => setCreate(false)} style={{ maxHeight: '90%' }}>
          <Dialog.Title>Gửi yêu cầu báo hỏng mới</Dialog.Title>
          <Dialog.ScrollArea style={{ paddingHorizontal: 16 }}>
            <View style={{ gap: 12, paddingVertical: 12 }}>
              <Filters
                options={['Nước & Vệ sinh', 'Điện & Chiếu sáng', 'Điều hòa', 'Cửa & Nội thất']}
                selected={category}
                onChange={setCategory}
              />
              <Filters
                options={['Bình thường', 'Khẩn cấp']}
                selected={severity}
                onChange={setSeverity}
              />
              <TextInput
                mode="outlined"
                label="Mô tả sự cố cụ thể"
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={4}
                error={!!error}
              />
              <Text variant="labelSmall" style={ui.red}>
                {error}
              </Text>
              <Button icon="camera-plus-outline" onPress={() => unavailable('Đính kèm ảnh sự cố')}>
                Chụp ảnh (tối đa 5 ảnh, 5 MB/ảnh)
              </Button>
              <Text variant="bodySmall" style={ui.muted}>
                Bản mẫu chưa gửi dữ liệu đến Ban quản lý.
              </Text>
            </View>
          </Dialog.ScrollArea>
          <Dialog.Actions>
            <Button onPress={() => setCreate(false)}>Đóng</Button>
            <Button
              onPress={() => {
                if (description.trim().length < 10) setError('Nhập ít nhất 10 ký tự mô tả sự cố.');
                else {
                  setError('');
                  setCreate(false);
                  unavailable('Gửi yêu cầu báo hỏng');
                }
              }}
            >
              Gửi yêu cầu
            </Button>
          </Dialog.Actions>
        </Dialog>
      </Portal>
    </>
  );
}
