import React, { useState } from 'react';
import { View } from 'react-native';
import { Button, Icon, Text } from 'react-native-paper';
import { Action, Box, Filters, Heading, InfoRow, Pill, Row, ui } from '../components/WorkspaceKit';
import {
  ChoiceField,
  EvidenceInput,
  Input,
  SubmissionResult,
} from '../components/WorkflowControls';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkflowDraft } from '../features/workflows/useWorkflowDraft';
import { workflowFixtures as f } from '../services/workflowFixtures';
import { colors as c } from '../theme/theme';

export function ResidenceTracking() {
  const form = useWorkflowDraft('residence', { start: '', result: '', reference: '', note: '' });
  if (form.submitted)
    return (
      <SubmissionResult
        title="Đã ghi nhận kết quả trên bản mẫu"
        status="Kết quả Tenant cung cấp • Chờ đối chiếu"
        onEdit={() => form.setSubmitted(false)}
      />
    );
  return (
    <>
      <Heading title="Theo dõi đăng ký tạm trú" detail="UC-18 • Chỉ hồ sơ cư trú của bạn" />
      <Box>
        <Pill tone="amber">Chưa có kết quả được đối chiếu • Mẫu</Pill>
        <Heading title="Thông tin chỗ ở để đăng ký" />
        <InfoRow
          icon="home-city-outline"
          title="P.301 • BHOME Cầu Giấy"
          detail="Địa chỉ chỗ ở phải do cơ sở xác nhận; bản mẫu chưa cung cấp địa chỉ pháp lý."
        />
        <InfoRow
          icon="file-document-outline"
          title="Hợp đồng: HD-2023-301B (mẫu)"
          detail="Owner cung cấp thông tin chỗ ở và xác nhận trên VNeID khi có yêu cầu."
        />
        <Text variant="bodySmall" style={ui.muted}>
          Hạn và quy định đăng ký theo hướng dẫn của cơ quan có thẩm quyền; BHOME chưa cấu hình hạn
          theo chính sách.
        </Text>
      </Box>
      <Box>
        <Heading title="Đăng ký ngoài BHOME" />
        {[
          '1. Mở ứng dụng VNeID chính thức trên thiết bị của bạn.',
          '2. Nhập thông tin và nộp hồ sơ trên VNeID.',
          '3. Owner xác nhận thông tin chỗ ở trên kênh chính thức khi được yêu cầu.',
          '4. Nhận kết quả và ghi nhận vào BHOME bên dưới.',
        ].map((line) => (
          <Text variant="bodyMedium" key={line}>
            {line}
          </Text>
        ))}
        <Text variant="bodySmall" style={ui.blue}>
          BHOME không gửi hồ sơ đến VNeID/công an và Staff không đăng ký thay Tenant.
        </Text>
      </Box>
      <Box>
        <Heading title="Ghi nhận kết quả đăng ký" />
        <Input
          label="Ngày bắt đầu cư trú dd/MM/yyyy *"
          value={form.data.start}
          onChange={(value) => form.change('start', value)}
        />
        <ChoiceField
          label="Kết quả trên kênh chính thức *"
          value={form.data.result}
          options={[
            { id: 'submitted', label: 'Đã nộp hồ sơ, đang xử lý' },
            { id: 'approved', label: 'Đã nhận kết quả đăng ký' },
            { id: 'correction', label: 'Được yêu cầu bổ sung / Sửa hồ sơ' },
            { id: 'rejected', label: 'Hồ sơ chưa được chấp nhận' },
          ]}
          onChange={(value) => form.change('result', value)}
        />
        <Input
          label="Mã hồ sơ / Tham chiếu kết quả *"
          value={form.data.reference}
          onChange={(value) => form.change('reference', value)}
        />
        <Input
          label="Ghi chú từ kết quả"
          multiline
          value={form.data.note}
          onChange={(value) => form.change('note', value)}
        />
        <EvidenceInput
          label="Bằng chứng kết quả (không dùng ảnh CCCD)"
          count={form.evidence}
          onChange={form.setEvidence}
        />
      </Box>
      <Box>
        <Heading title="Xác nhận thông tin chỗ ở của Owner" />
        <Pill tone="neutral">Chưa có dữ liệu xác nhận từ API</Pill>
        <Text variant="bodySmall">
          Trạng thái do Owner/kênh chính thức cung cấp; Tenant không tự đổi thành Owner đã xác nhận.
        </Text>
      </Box>
      {form.errors.map((error) => (
        <Text key={error} style={ui.red}>
          {error}
        </Text>
      ))}
      <Action icon="content-save-outline" onPress={() => void form.submit()}>
        Ghi nhận kết quả bản mẫu
      </Action>
    </>
  );
}
export function InvoiceAdjustment() {
  const form = useWorkflowDraft('adjustment', { invoice: '', charge: '', reason: '', amount: '' });
  const { go } = useWorkspace();
  if (form.submitted)
    return (
      <>
        <SubmissionResult
          title="Đã tạo yêu cầu trên bản mẫu"
          onEdit={() => form.setSubmitted(false)}
        />
        <Action secondary onPress={() => go('invoice')}>
          Về hóa đơn
        </Action>
      </>
    );
  return (
    <>
      <Heading title="Yêu cầu điều chỉnh hóa đơn" detail="UC-24 • Owner xem xét và quyết định" />
      <Box>
        <ChoiceField
          label="Hóa đơn của bạn *"
          value={form.data.invoice}
          options={f.invoices}
          onChange={(value) => form.change('invoice', value)}
        />
        <ChoiceField
          label="Khoản thu tranh chấp *"
          value={form.data.charge}
          options={[
            { id: 'rent', label: 'Tiền thuê phòng' },
            { id: 'electric', label: 'Tiền điện' },
            { id: 'water', label: 'Tiền nước' },
            { id: 'service', label: 'Phí dịch vụ' },
          ]}
          onChange={(value) => form.change('charge', value)}
        />
        <Input
          label="Lý do và thông tin cần kiểm tra *"
          multiline
          value={form.data.reason}
          onChange={(value) => form.change('reason', value)}
        />
        <Input
          label="Số tiền đề nghị kiểm tra (đ, nếu có)"
          numeric
          value={form.data.amount}
          onChange={(value) => form.change('amount', value)}
        />
        <EvidenceInput count={form.evidence} onChange={form.setEvidence} />
      </Box>
      <Box style={{ backgroundColor: c.tint }}>
        <Heading title="Hóa đơn gốc được giữ nguyên" />
        <Text variant="bodySmall">
          Trước phát hành: Owner có thể duyệt sửa bản Draft. Sau phát hành: ghi nhận Invoice
          Adjustment riêng, không sửa trực tiếp hóa đơn đã chốt.
        </Text>
        <Text variant="bodySmall">
          Yêu cầu không tự xóa khoản phải trả; kết quả và nghĩa vụ thanh toán theo quyết định được
          xác nhận.
        </Text>
      </Box>
      {form.errors.map((error) => (
        <Text key={error} style={ui.red}>
          {error}
        </Text>
      ))}
      <Action icon="send-outline" onPress={() => void form.submit()}>
        Gửi Owner xem xét bản mẫu
      </Action>
      <Heading
        title="Theo dõi yêu cầu trước đây"
        detail="Ví dụ trạng thái • Không phải dữ liệu thật"
      />
      <Box>
        <Pill tone="amber">Chờ Owner</Pill>
        <Text variant="bodySmall">
          P.301 • Kiểm tra phí dịch vụ kỳ 09/2024 • Chưa có quyết định.
        </Text>
      </Box>
      <Box>
        <Pill tone="red">Từ chối</Pill>
        <Text variant="bodySmall">
          Kỳ 08/2024 • Owner phản hồi: Chỉ số đã khớp ảnh xác nhận. Hóa đơn giữ nguyên (mẫu).
        </Text>
      </Box>
    </>
  );
}
export function ContractRequest() {
  const form = useWorkflowDraft('contract-request', {
    type: 'renewal',
    date: '',
    reason: '',
    period: '',
    note: '',
  });
  const { go } = useWorkspace();
  if (form.submitted)
    return (
      <>
        <SubmissionResult
          title="Đã ghi nhận nguyện vọng bản mẫu"
          onEdit={() => form.setSubmitted(false)}
        />
        <Action secondary onPress={() => go('signing')}>
          Theo dõi ký phụ lục / Hợp đồng
        </Action>
      </>
    );
  return (
    <>
      <Heading title="Gia hạn / Chấm dứt trước hạn" detail="UC-16 / UC-19 • Chỉ hợp đồng của bạn" />
      <Box>
        <Heading title="Hợp đồng hiện tại" detail="HD-2023-301B • P.301 • Mẫu" />
        <Row spread>
          <Text variant="bodySmall">Ngày hết hạn</Text>
          <Text variant="titleMedium">25/11/2025 (theo thiết kế)</Text>
        </Row>
        <Text variant="bodySmall" style={ui.muted}>
          Mẫu dùng kỳ hạn lịch sử; ngày thật sẽ lấy từ hợp đồng đã xác nhận.
        </Text>
      </Box>
      <Box>
        <ChoiceField
          label="Nguyện vọng *"
          value={form.data.type}
          options={[
            { id: 'renewal', label: 'Đề nghị gia hạn' },
            { id: 'early', label: 'Đề nghị chấm dứt trước hạn' },
            { id: 'non-renewal', label: 'Không gia hạn khi hết hạn' },
          ]}
          onChange={(value) => form.change('type', value)}
        />
        <Input
          label={
            form.data.type === 'renewal'
              ? 'Ngày bắt đầu kỳ gia hạn dd/MM/yyyy *'
              : 'Ngày dự kiến trả phòng dd/MM/yyyy *'
          }
          value={form.data.date}
          onChange={(value) => form.change('date', value)}
        />
        {form.data.type === 'renewal' && (
          <Input
            label="Kỳ hạn / Điều khoản mong muốn"
            value={form.data.period}
            onChange={(value) => form.change('period', value)}
          />
        )}
        <Input
          label="Lý do / Nguyện vọng cụ thể *"
          multiline
          value={form.data.reason}
          onChange={(value) => form.change('reason', value)}
        />
        <Input
          label="Ghi chú hẹn kiểm tra / Liên hệ"
          multiline
          value={form.data.note}
          onChange={(value) => form.change('note', value)}
        />
      </Box>
      <Box>
        <Heading title="Thông tin nghĩa vụ liên quan" />
        <InfoRow
          icon="shield-check-outline"
          title="Owner quyết định điều khoản"
          detail="Không tự đổi hạn hợp đồng hoặc tự chuyển trạng thái thuê."
        />
        <InfoRow
          icon="bank-outline"
          title="Cọc và khoản phải thanh toán"
          detail="Chưa tính khấu trừ, phạt, hoàn cọc hay cam kết thời hạn hoàn tiền."
        />
        <InfoRow
          icon="clipboard-check-outline"
          title="Kiểm tra & Quyết toán trả phòng"
          detail="Staff kiểm tra, Owner duyệt hiện trạng và quyết toán. Không giải phóng phòng khi nghĩa vụ chưa xử lý."
        />
      </Box>
      {form.errors.map((error) => (
        <Text key={error} style={ui.red}>
          {error}
        </Text>
      ))}
      <Action icon="send-outline" onPress={() => void form.submit()}>
        Gửi nguyện vọng bản mẫu
      </Action>
      <Box>
        <Heading title="Trạng thái yêu cầu" />
        <Pill tone="neutral">Chưa có yêu cầu thật được tải từ API</Pill>
        <Text variant="bodySmall">
          Quy trình: Chờ Owner → Kiểm tra điều khoản → Ký phụ lục hoặc Kiểm tra trả phòng → Quyết
          toán.
        </Text>
      </Box>
    </>
  );
}
export function BillingHistory() {
  const { go, unavailable } = useWorkspace();
  const [filter, setFilter] = useState('Tất cả');
  const [selected, setSelected] = useState<string | null>(null);
  const items = f.payments.filter((item) => filter === 'Tất cả' || item.status === filter);
  return (
    <>
      <Heading
        title="Hóa đơn & Lịch sử thanh toán"
        detail="UC-21 / UC-25 • Chỉ dữ liệu phòng của bạn"
      />
      <Box>
        <Row spread>
          <Text variant="bodyMedium">P.301 • Dữ liệu mẫu</Text>
          <Pill>Chuyển khoản ngân hàng</Pill>
        </Row>
        <Text variant="labelSmall" style={ui.muted}>
          Giao dịch chỉ được xem là thanh toán khi ngân hàng/Owner đã xác minh.
        </Text>
      </Box>
      <Filters
        options={['Tất cả', 'Chờ thanh toán', 'Đã thanh toán', 'Quá hạn']}
        selected={filter}
        onChange={setFilter}
      />
      {items.map((item) => (
        <Box key={item.id}>
          <Row spread>
            <Text variant="titleLarge">Kỳ {item.period}</Text>
            <Pill tone={item.status === 'Đã thanh toán' ? 'green' : 'amber'}>{item.status}</Pill>
          </Row>
          <Text variant="headlineSmall" style={ui.money}>
            {item.amount}
          </Text>
          <Text variant="bodySmall" style={ui.muted}>
            {item.date}
          </Text>
          <Text variant="bodySmall">{item.bank}</Text>
          <Action
            secondary
            icon="receipt-text-outline"
            onPress={() => setSelected(selected === item.id ? null : item.id)}
          >
            Chi tiết & Phân bổ giao dịch
          </Action>
          {selected === item.id && (
            <View style={ui.soft}>
              <Text variant="titleMedium">Hóa đơn mẫu • {item.id}</Text>
              <Text variant="bodySmall">
                {item.status === 'Đã thanh toán'
                  ? `Đã phân bổ ${item.amount} vào nghĩa vụ kỳ ${item.period}. Số liệu minh họa; không phải biên lai.`
                  : 'Chưa có khoản thanh toán được xác minh.'}
              </Text>
              <Button
                onPress={() =>
                  item.period === '10/2024'
                    ? go('invoice')
                    : unavailable('Tải chứng từ hóa đơn lịch sử')
                }
              >
                Xem hóa đơn / Chứng từ
              </Button>
            </View>
          )}
        </Box>
      ))}
      {!items.length && (
        <Box>
          <Icon source="receipt-text-check-outline" size={36} color={c.muted} />
          <Text>Không có hóa đơn trong nhóm đã chọn.</Text>
        </Box>
      )}
      <Action secondary onPress={() => go('adjustment')}>
        Yêu cầu kiểm tra / Điều chỉnh hóa đơn
      </Action>
    </>
  );
}
export function SigningStatus() {
  const { role, unavailable } = useWorkspace();
  const [scenario, setScenario] = useState('Pending');
  const [notice, setNotice] = useState('');
  return (
    <>
      <Heading
        title="Trạng thái ký hợp đồng"
        detail="UC-14 / UC-15 / UC-16 • Nhà cung cấp ký điện tử bên ngoài"
      />
      <Text variant="labelSmall" style={ui.muted}>
        Tình huống dữ liệu mẫu để kiểm tra giao diện:
      </Text>
      <Filters
        options={['Pending', 'Signed', 'Failed', 'Cancelled']}
        selected={scenario}
        onChange={(value) => {
          setScenario(value);
          setNotice('');
        }}
      />
      <Box>
        <Heading
          title={
            role === 'Tenant'
              ? 'Hợp đồng của bạn • P.301'
              : 'Hợp đồng trong phạm vi được phép • P.301'
          }
          detail="HD-MAU-301 • Không phải tài liệu có hiệu lực"
        />
        <InfoRow
          icon="file-sign"
          title="Tham chiếu nhà cung cấp"
          detail="sample-provider-ref-301 • Minh họa"
        />
        <Row spread>
          <Text variant="titleMedium">Kết quả ký</Text>
          <Pill
            tone={
              scenario === 'Signed'
                ? 'green'
                : scenario === 'Failed' || scenario === 'Cancelled'
                  ? 'red'
                  : 'amber'
            }
          >
            {scenario}
          </Pill>
        </Row>
        {['Owner', 'Tenant'].map((signer) => (
          <InfoRow
            key={signer}
            icon={scenario === 'Signed' ? 'check-circle-outline' : 'clock-outline'}
            title={`Bên ký: ${signer}`}
            detail={
              scenario === 'Signed'
                ? 'Đã ký • 25/11/2023 10:15 • Thời gian mẫu'
                : scenario === 'Failed'
                  ? 'Ký thất bại • Chờ kiểm tra tại nhà cung cấp'
                  : scenario === 'Cancelled'
                    ? 'Đã hủy quy trình ký • Không kích hoạt'
                    : 'Đang chờ ký • Chưa có thời điểm hoàn tất'
            }
          />
        ))}
        <Button
          icon="file-certificate-outline"
          onPress={() => unavailable('Tải bằng chứng và kiểm tra tính toàn vẹn chữ ký')}
        >
          Xem tài liệu & Bằng chứng ký
        </Button>
      </Box>
      {(scenario === 'Failed' || scenario === 'Cancelled') && (
        <Box style={{ backgroundColor: c.redSoft }}>
          <Heading
            title={scenario === 'Failed' ? 'Nhà cung cấp chưa hoàn tất ký' : 'Quy trình ký đã hủy'}
          />
          <Text variant="bodySmall">
            Hợp đồng không được kích hoạt. Giữ lại lịch sử và liên hệ Owner để xử lý; không tự phát
            hành chứng thư.
          </Text>
        </Box>
      )}
      <Box>
        <Heading title="Điều kiện kích hoạt" />
        <InfoRow
          icon="draw"
          title="Đủ chữ ký Owner và Tenant"
          detail="Trạng thái và bằng chứng phải do nhà cung cấp xác nhận."
        />
        <InfoRow
          icon="bank-transfer"
          title="Đủ điều kiện thanh toán"
          detail="Cọc/tiền ban đầu cần được xác minh, không dựa riêng ảnh chuyển khoản."
        />
        <InfoRow
          icon="account-check-outline"
          title="Owner xác nhận kích hoạt"
          detail="Staff và Tenant không tự kích hoạt phòng/hợp đồng."
        />
      </Box>
      {(role === 'Owner' || role === 'Tenant') && scenario === 'Pending' && (
        <Action
          icon="open-in-new"
          onPress={() => unavailable('Mở phiên ký tại nhà cung cấp đã được xác thực')}
        >
          Tiếp tục ký với nhà cung cấp
        </Action>
      )}
      <Action
        secondary
        icon="refresh"
        onPress={() =>
          setNotice('Đây là dữ liệu mẫu. Chưa gửi yêu cầu cập nhật trạng thái đến nhà cung cấp.')
        }
      >
        Kiểm tra trạng thái
      </Action>
      {!!notice && <Text style={ui.blue}>{notice}</Text>}
      <Text variant="bodySmall" style={ui.muted}>
        BHOME không lưu khóa riêng hoặc phát hành chứng thư số. Staff chỉ chuẩn bị và theo dõi hồ sơ
        được phân công.
      </Text>
    </>
  );
}
