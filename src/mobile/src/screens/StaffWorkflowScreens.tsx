import React, { useState } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import {
  ActivityIndicator,
  Button,
  Checkbox,
  ProgressBar,
  Searchbar,
  Text,
} from 'react-native-paper';
import { Action, Box, Filters, Heading, InfoRow, Pill, Row, ui } from '../components/WorkspaceKit';
import {
  ChoiceField,
  EvidenceInput,
  Input,
  SubmissionResult,
} from '../components/WorkflowControls';
import { useWorkspace } from '../features/workspace/WorkspaceProvider';
import { useWorkflowDraft } from '../features/workflows/useWorkflowDraft';
import { useCaptureScope } from '../features/onboarding/useCaptureScope';
import { workflowFixtures as f } from '../services/workflowFixtures';
import { sampleWorkOrders } from '../services/workspaceData';
import { colors as c } from '../theme/theme';

export function ContractPreparation() {
  const { go } = useWorkspace();
  const form = useWorkflowDraft('contract', {
    room: '',
    tenant: '',
    type: 'holding',
    start: '',
    end: '',
    terms: '',
    deposit: '',
    rent: '',
    source: 'direct',
    holdingRef: '',
  });
  const [review, setReview] = useState(false);
  if (form.submitted)
    return (
      <>
        <SubmissionResult
          title="Đã tạo yêu cầu duyệt bản mẫu"
          onEdit={() => form.setSubmitted(false)}
        />
        <Action onPress={() => go('signing')}>Theo dõi trạng thái ký</Action>
      </>
    );
  return (
    <>
      <Heading
        title="Chuẩn bị hợp đồng"
        detail="UC-14 / UC-15 • Owner duyệt và quyết định kích hoạt"
      />
      <Pill tone="amber">Bản nháp • Chưa giữ chỗ / Chưa kích hoạt</Pill>
      <Box>
        <ChoiceField
          label="Loại hợp đồng *"
          value={form.data.type}
          options={[
            { id: 'holding', label: 'Hợp đồng giữ chỗ' },
            { id: 'main', label: 'Hợp đồng thuê chính' },
          ]}
          onChange={(value) => form.change('type', value)}
        />
        <ChoiceField
          label="Phòng trong cơ sở được phân công *"
          value={form.data.room}
          options={f.rooms}
          onChange={(value) => form.change('room', value)}
        />
        <ChoiceField
          label="Tenant đại diện *"
          value={form.data.tenant}
          options={f.tenants}
          onChange={(value) => form.change('tenant', value)}
        />
        <Button icon="account-plus-outline" onPress={() => go('onboarding')}>
          Tiếp nhận Tenant / Người cùng ở
        </Button>
        {form.data.type === 'main' && (
          <ChoiceField
            label="Nguồn tạo"
            value={form.data.source}
            options={[
              { id: 'direct', label: 'Tạo trực tiếp từ phòng đủ điều kiện' },
              { id: 'holding', label: 'Chuyển từ hợp đồng giữ chỗ hợp lệ' },
            ]}
            onChange={(value) => form.change('source', value)}
          />
        )}
        {form.data.type === 'main' && form.data.source === 'holding' && (
          <Input
            label="Tham chiếu hợp đồng giữ chỗ *"
            value={form.data.holdingRef}
            onChange={(value) => form.change('holdingRef', value)}
          />
        )}
        <Text variant="bodySmall" style={ui.muted}>
          Phòng, hợp đồng giữ chỗ và người thuê phải được backend kiểm tra đủ điều kiện trước khi
          gửi ký. Mẫu không xác lập khả năng cho thuê.
        </Text>
      </Box>
      <Box>
        <Heading title="Kỳ hạn & Điều kiện tài chính" />
        <Input
          label="Ngày bắt đầu dd/MM/yyyy *"
          value={form.data.start}
          onChange={(value) => form.change('start', value)}
        />
        <Input
          label={
            form.data.type === 'holding' ? 'Hạn giữ chỗ dd/MM/yyyy *' : 'Ngày kết thúc dd/MM/yyyy *'
          }
          value={form.data.end}
          onChange={(value) => form.change('end', value)}
        />
        {form.data.type === 'main' && (
          <Input
            label="Tiền thuê/tháng theo chính sách (đ) *"
            numeric
            value={form.data.rent}
            onChange={(value) => form.change('rent', value)}
          />
        )}
        <Input
          label={
            form.data.type === 'holding'
              ? 'Tiền cọc giữ chỗ theo chính sách (đ) *'
              : 'Tiền cọc an ninh theo chính sách (đ) *'
          }
          numeric
          value={form.data.deposit}
          onChange={(value) => form.change('deposit', value)}
        />
        <Input
          label="Điều khoản & Điều kiện thanh toán *"
          multiline
          value={form.data.terms}
          onChange={(value) => form.change('terms', value)}
        />
        <Text variant="bodySmall" style={ui.muted}>
          Không tự khấu trừ/chuyển cọc. Khoản cọc giữ chỗ đã xác minh chỉ được áp dụng theo quyết
          định và chính sách của Owner.
        </Text>
      </Box>
      <Box>
        <Heading title="Kiểm tra trước khi gửi" />
        <InfoRow
          icon="account-check-outline"
          title="Người ký: Owner và Tenant"
          detail="Staff chuẩn bị và theo dõi, không ký thay và không tự kích hoạt."
        />
        <InfoRow
          icon="bank-transfer"
          title="Thanh toán bằng chuyển khoản"
          detail="Chỉ kích hoạt sau khi đủ chữ ký, điều kiện thanh toán và Owner xác nhận."
        />
        <Checkbox.Item
          label="Tôi đã rà soát hồ sơ và điều khoản để gửi Owner"
          status={review ? 'checked' : 'unchecked'}
          onPress={() => setReview(!review)}
        />
      </Box>
      {form.errors.map((error) => (
        <Text key={error} style={ui.red}>
          {error}
        </Text>
      ))}
      <Button
        mode="contained"
        disabled={!review || form.busy}
        loading={form.busy}
        onPress={() => void form.submit()}
      >
        Gửi Owner duyệt bản nháp
      </Button>
    </>
  );
}
export function Inspection({ moveIn = false }: { moveIn?: boolean }) {
  const form = useWorkflowDraft(moveIn ? 'move-in' : 'move-out', {
    room: '',
    date: '',
    condition: '',
    electric: '',
    water: '',
    keys: '',
    damage: '',
  });
  const [conditions, setConditions] = useState<Record<string, string>>({});
  const [confirmed, setConfirmed] = useState(false);
  if (form.submitted)
    return (
      <SubmissionResult
        title={moveIn ? 'Biên bản bàn giao mẫu đã ghi nhận' : 'Biên bản kiểm tra mẫu đã ghi nhận'}
        status={moveIn ? 'Chờ Tenant đối chiếu và xác nhận' : 'Chờ Owner kiểm tra'}
        onEdit={() => form.setSubmitted(false)}
      />
    );
  return (
    <>
      <Heading
        title={moveIn ? 'Bàn giao nhận phòng' : 'Kiểm tra trả phòng'}
        detail={
          moveIn
            ? 'UC-17 • Staff và Tenant cùng xác nhận'
            : 'UC-19 • Owner duyệt hiện trạng và quyết toán'
        }
      />
      <Box>
        <ChoiceField
          label="Phòng / Hợp đồng được phân công *"
          options={f.rooms}
          value={form.data.room}
          onChange={(value) => form.change('room', value)}
        />
        <Input
          label="Ngày kiểm tra dd/MM/yyyy *"
          value={form.data.date}
          onChange={(value) => form.change('date', value)}
        />
        <Pill>Baseline nhận phòng: 25/11/2023 • Mẫu</Pill>
        <Input
          label="Hiện trạng phòng thực tế *"
          multiline
          value={form.data.condition}
          onChange={(value) => form.change('condition', value)}
        />
      </Box>
      <Box>
        <Heading title="Kiểm kê tài sản & Hiện trạng" />
        {f.assets.map((asset) => (
          <View key={asset} style={[ui.soft, { gap: 8 }]}>
            <Text variant="titleMedium">{asset}</Text>
            <ChoiceField
              label="Kết quả kiểm tra"
              value={conditions[asset] ?? ''}
              options={[
                { id: 'good', label: 'Hoạt động tốt / Đủ' },
                { id: 'wear', label: 'Hao mòn cần ghi nhận' },
                { id: 'damage', label: 'Hỏng / Thiếu • Cần Owner xem xét' },
              ]}
              onChange={(value) => setConditions((before) => ({ ...before, [asset]: value }))}
            />
          </View>
        ))}
        <Input
          label="Mô tả hỏng, thiếu và chênh lệch so baseline"
          multiline
          value={form.data.damage}
          onChange={(value) => form.change('damage', value)}
        />
        <Input
          label="Chìa khóa / Thẻ bàn giao *"
          value={form.data.keys}
          onChange={(value) => form.change('keys', value)}
        />
      </Box>
      <Box>
        <Heading title={moveIn ? 'Chỉ số ban đầu' : 'Chỉ số cuối kỳ'} />
        <Input
          label="Điện (kWh) *"
          numeric
          value={form.data.electric}
          onChange={(value) => form.change('electric', value)}
        />
        <Input
          label="Nước (m³) *"
          numeric
          value={form.data.water}
          onChange={(value) => form.change('water', value)}
        />
        <Text variant="bodySmall" style={ui.muted}>
          Backend phải đối chiếu mã đồng hồ, chỉ số trước và trường hợp thay đồng hồ. Chỉ số mẫu
          chưa được tính phí.
        </Text>
        <EvidenceInput count={form.evidence} onChange={form.setEvidence} />
      </Box>
      <Box>
        <Checkbox.Item
          label="Tôi đã kiểm tra đủ thiết bị và đối chiếu chỉ số/ảnh"
          status={confirmed ? 'checked' : 'unchecked'}
          onPress={() => setConfirmed(!confirmed)}
        />
        <Text variant="bodySmall" style={ui.muted}>
          {moveIn
            ? 'Tenant còn phải xác nhận nội dung; không thay thế chữ ký hợp đồng điện tử.'
            : 'Staff không tự khấu trừ tiền cọc, chốt quyết toán hoặc chuyển phòng sang Trống.'}
        </Text>
      </Box>
      {form.errors.map((error) => (
        <Text style={ui.red} key={error}>
          {error}
        </Text>
      ))}
      <Button
        mode="contained"
        disabled={!confirmed || Object.keys(conditions).length !== f.assets.length || form.busy}
        onPress={() => void form.submit()}
      >
        {moveIn ? 'Gửi Tenant đối chiếu bản mẫu' : 'Gửi Owner kiểm tra bản mẫu'}
      </Button>
    </>
  );
}
export function StaffSchedule() {
  const [filter, setFilter] = useState('Tất cả');
  return (
    <>
      <Heading title="Lịch ca của tôi" detail="UC-09 • Lịch do Owner phân công • Dữ liệu mẫu" />
      <Filters
        options={['Tất cả', 'Đã phân công', 'Đã điều chỉnh', 'Nghỉ']}
        selected={filter}
        onChange={setFilter}
      />
      {f.shifts
        .filter((shift) => filter === 'Tất cả' || shift.status === filter)
        .map((shift) => (
          <Box key={shift.date}>
            <Row spread>
              <Text variant="titleLarge">
                {shift.day} • {shift.date}
              </Text>
              <Pill tone={shift.status === 'Đã điều chỉnh' ? 'amber' : 'blue'}>{shift.status}</Pill>
            </Row>
            <Text variant="headlineSmall">{shift.hours}</Text>
            <Text variant="bodyMedium">{shift.location}</Text>
            <Text variant="bodySmall" style={ui.muted}>
              {shift.detail}
            </Text>
          </Box>
        ))}
      <Box>
        <Text variant="bodySmall">
          Staff có quyền xem ca của mình và lịch sử thay đổi. Không hỗ trợ đổi ca, xin chuyển ca
          hoặc giao ca giữa Staff.
        </Text>
      </Box>
    </>
  );
}
export function RoomOverview() {
  const { preview, go } = useWorkspace();
  const scope = useCaptureScope();
  const [query, setQuery] = useState('');
  return (
    <>
      <Heading title="Phòng & Người ở" detail="UC-05 / UC-13 • Chỉ dữ liệu được cấp quyền" />
      <Box>
        <ChoiceField
          label="Cơ sở được phân công"
          value={scope.location}
          options={scope.locations}
          onChange={scope.selectLocation}
        />
        <Searchbar placeholder="Tìm phòng…" value={query} onChangeText={setQuery} />
        {scope.loading && <ActivityIndicator />}
        {!!scope.error && (
          <>
            <Text style={ui.red}>{scope.error}</Text>
            <Button onPress={scope.reload}>Thử lại</Button>
          </>
        )}
        {!scope.loading && !scope.locations.length && <Text>Chưa có cơ sở được phân công.</Text>}
      </Box>
      {scope.rooms
        .filter((room) => room.label.toLowerCase().includes(query.toLowerCase()))
        .map((room) => (
          <Box key={room.id}>
            <Heading
              title={`Phòng ${room.label}`}
              detail={
                preview ? 'BHOME Đống Đa - Tòa B • Mẫu' : 'Phòng trong phạm vi máy chủ trả về'
              }
            />
            {scope.residents
              .filter((resident) => resident.roomId === room.id)
              .map((resident) => (
                <InfoRow
                  key={resident.id}
                  icon="account-outline"
                  title={resident.displayLabel}
                  detail={
                    resident.verificationStatus === 1
                      ? 'Thông tin đã được xác nhận'
                      : 'Chờ Staff xác nhận thông tin'
                  }
                  onPress={() => go('onboarding', { residentId: resident.id })}
                />
              ))}
            {!scope.residents.some((resident) => resident.roomId === room.id) && (
              <Text variant="bodySmall" style={ui.muted}>
                Chưa có hồ sơ cư dân được trả về.
              </Text>
            )}
            <Action secondary onPress={() => go('onboarding')}>
              Tiếp nhận / Xác minh cư dân
            </Action>
          </Box>
        ))}
      {!!scope.location && !scope.loading && !scope.rooms.length && (
        <Box>
          <Text>Không có phòng phù hợp.</Text>
        </Box>
      )}
      <Text variant="labelSmall" style={ui.muted}>
        Không tải CCCD, số tài khoản hoặc dữ liệu định danh sâu trong danh sách phòng.
      </Text>
    </>
  );
}
export function DebtFollowUp() {
  const form = useWorkflowDraft('debt', { outcome: '', note: '' });
  const [room, setRoom] = useState('debt-302');
  const debt = f.debts.find((item) => item.id === room)!;
  if (form.submitted)
    return (
      <SubmissionResult
        title="Đã ghi nhận liên hệ trên bản mẫu"
        status="Chờ Owner phối hợp nếu cần"
        onEdit={() => form.setSubmitted(false)}
      />
    );
  return (
    <>
      <Heading
        title="Theo dõi công nợ được giao"
        detail="UC-23 • Dữ liệu tác nghiệp tối thiểu trong cơ sở"
      />
      <Box>
        <ChoiceField
          label="Phòng / Kỳ cần liên hệ"
          value={room}
          options={f.debts.map((item) => ({ id: item.id, label: `${item.room} • ${item.period}` }))}
          onChange={setRoom}
        />
        <Row spread>
          <Text variant="headlineSmall">{debt.amount}</Text>
          <Pill tone={debt.status === 'Quá hạn' ? 'red' : 'blue'}>{debt.status}</Pill>
        </Row>
        <Text variant="bodySmall">
          Hạn: {debt.due} • {debt.note}
        </Text>
        <Text variant="bodySmall" style={ui.muted}>
          Không hiển thị doanh thu chuỗi, lợi nhuận, số dư ngân hàng hoặc CCCD.
        </Text>
      </Box>
      <Box>
        <Heading title="Ghi nhận kết quả liên hệ" />
        <ChoiceField
          label="Kết quả *"
          value={form.data.outcome}
          options={[
            { id: 'contacted', label: 'Đã liên hệ, Tenant đã tiếp nhận nhắc' },
            { id: 'no-response', label: 'Chưa liên hệ được' },
            { id: 'review', label: 'Tenant báo đã chuyển khoản • Nhờ Owner kiểm tra' },
            { id: 'dispute', label: 'Có tranh chấp • Nhờ Owner xử lý' },
          ]}
          onChange={(value) => form.change('outcome', value)}
        />
        <Input
          label="Ghi chú liên hệ *"
          multiline
          value={form.data.note}
          onChange={(value) => form.change('note', value)}
        />
        <Text variant="bodySmall" style={ui.muted}>
          Staff không xác nhận thu tiền, ghi nhận tiền mặt, tự gạch nợ hay sửa hóa đơn.
        </Text>
      </Box>
      {form.errors.map((error) => (
        <Text key={error} style={ui.red}>
          {error}
        </Text>
      ))}
      <Action icon="note-check-outline" onPress={() => void form.submit()}>
        Ghi nhận liên hệ bản mẫu
      </Action>
    </>
  );
}
export function TaskDetail() {
  const { taskId } = useLocalSearchParams<{ taskId?: string }>();
  const { go } = useWorkspace();
  const item = sampleWorkOrders.find((task) => task.id === taskId) ?? sampleWorkOrders[0];
  const form = useWorkflowDraft('task', {
    progress: '50',
    note: '',
    blocker: '',
    mode: 'progress',
    cost: '',
    duration: '',
  });
  if (form.submitted)
    return (
      <>
        <SubmissionResult
          title={
            form.data.mode === 'proposal'
              ? 'Đã gửi phương án trên bản mẫu'
              : form.data.mode === 'submit'
                ? 'Đã gửi kết quả trên bản mẫu'
                : 'Đã ghi nhận tiến độ bản mẫu'
          }
          status={
            form.data.mode === 'proposal'
              ? 'Pending Approval • Owner duyệt phương án'
              : form.data.mode === 'submit'
                ? 'Pending Verification • Owner kiểm tra'
                : 'In Progress • Công việc vẫn mở'
          }
          onEdit={() => form.setSubmitted(false)}
        />
        <Action secondary onPress={() => go('work-orders')}>
          Về danh sách công việc
        </Action>
      </>
    );
  return (
    <>
      <Heading
        title={`Chi tiết công việc #${item.id}`}
        detail={`${item.room} • Cơ sở được phân công`}
      />
      <Box>
        <Pill tone="amber">{item.status}</Pill>
        <Text variant="titleLarge">{item.title}</Text>
        <Text variant="bodySmall">{item.detail}</Text>
        <Text variant="labelSmall">Thời hạn: {item.time} • Người thực hiện: Staff mẫu</Text>
        <ProgressBar
          progress={Math.min(100, Math.max(0, Number(form.data.progress) || 0)) / 100}
          color={c.blue}
        />
      </Box>
      <Box>
        <Heading title="Tiến độ / Vướng mắc / Kết quả" />
        <ChoiceField
          label="Loại cập nhật"
          value={form.data.mode}
          options={[
            { id: 'progress', label: 'Cập nhật tiến độ' },
            { id: 'blocker', label: 'Báo vướng mắc, cần Owner phối hợp' },
            { id: 'submit', label: 'Gửi kết quả để Owner kiểm tra' },
            { id: 'proposal', label: 'Đề xuất phương án / Chi phí / Thời gian sửa chữa' },
          ]}
          onChange={(value) => form.change('mode', value)}
        />
        <Input
          label="Tiến độ (%) *"
          value={form.data.progress}
          numeric
          onChange={(value) => form.change('progress', value)}
        />
        <Input
          label="Nội dung công việc / Kết quả *"
          value={form.data.note}
          multiline
          onChange={(value) => form.change('note', value)}
        />
        {form.data.mode === 'blocker' && (
          <Input
            label="Vướng mắc & hỗ trợ cần thiết"
            value={form.data.blocker}
            multiline
            onChange={(value) => form.change('blocker', value)}
          />
        )}
        <EvidenceInput count={form.evidence} onChange={form.setEvidence} />
        {form.data.mode === 'proposal' && (
          <>
            <Input
              label="Dự toán chi phí đề xuất (đ) *"
              numeric
              value={form.data.cost}
              onChange={(value) => form.change('cost', value)}
            />
            <Input
              label="Thời gian / Lịch thực hiện đề xuất *"
              value={form.data.duration}
              onChange={(value) => form.change('duration', value)}
            />
            <Text variant="bodySmall" style={ui.muted}>
              Chờ Owner duyệt phương án và kinh phí trước khi thực hiện. Staff không tự duyệt chi
              phí.
            </Text>
          </>
        )}
        <Text variant="bodySmall" style={ui.muted}>
          Gửi kết quả chỉ chuyển sang chờ Owner kiểm tra. Staff không tự đánh dấu Completed.
        </Text>
      </Box>
      <Box>
        <Heading title="Lịch sử xử lý" />
        <InfoRow
          icon="account-arrow-right-outline"
          title="Owner phân công"
          detail="08:00 • Giao việc tại cơ sở mẫu"
        />
        <InfoRow
          icon="progress-clock"
          title="Staff tiếp nhận"
          detail="08:15 • Đang xử lý, chưa Owner nghiệm thu"
        />
      </Box>
      {form.errors.map((error) => (
        <Text key={error} style={ui.red}>
          {error}
        </Text>
      ))}
      <Action icon="send-outline" onPress={() => void form.submit()}>
        Gửi cập nhật bản mẫu
      </Action>
    </>
  );
}
export function StaffIncidentReport() {
  const form = useWorkflowDraft('incident', { room: '', severity: 'normal', description: '' });
  if (form.submitted)
    return (
      <SubmissionResult
        title="Đã ghi nhận báo cáo trên bản mẫu"
        status={
          form.data.severity === 'emergency'
            ? 'Emergency • Cần Owner/Staff tại cơ sở phản hồi'
            : 'Normal • Chờ Owner xem xét'
        }
        onEdit={() => form.setSubmitted(false)}
      />
    );
  return (
    <>
      <Heading
        title="Báo sự cố tại cơ sở"
        detail="UC-26 / UC-27 • Chỉ cơ sở Staff được phân công"
      />
      <Box>
        <ChoiceField
          label="Phòng / Khu vực *"
          value={form.data.room}
          options={[...f.rooms, { id: 'common', label: 'Khu vực chung • Tòa B Đống Đa' }]}
          onChange={(value) => form.change('room', value)}
        />
        <ChoiceField
          label="Mức độ *"
          value={form.data.severity}
          options={[
            { id: 'normal', label: 'Normal • Bình thường' },
            { id: 'emergency', label: 'Emergency • Khẩn cấp' },
          ]}
          onChange={(value) => form.change('severity', value)}
        />
        {form.data.severity === 'emergency' && (
          <Text style={ui.red}>
            Nếu có nguy hiểm trực tiếp, liên hệ dịch vụ khẩn cấp công cộng trước; ghi nhận hành động
            an toàn trong khả năng của bạn. Không chờ phản hồi từ app.
          </Text>
        )}
        <Input
          label="Mô tả sự cố / Thiết bị liên quan *"
          multiline
          value={form.data.description}
          onChange={(value) => form.change('description', value)}
        />
        <EvidenceInput count={form.evidence} onChange={form.setEvidence} />
        <Text variant="bodySmall" style={ui.muted}>
          Staff chọn mức độ, không tự phân loại bằng AI hoặc tự duyệt chi phí sửa chữa.
        </Text>
      </Box>
      {form.errors.map((error) => (
        <Text key={error} style={ui.red}>
          {error}
        </Text>
      ))}
      <Action onPress={() => void form.submit()}>Gửi báo cáo bản mẫu</Action>
    </>
  );
}
