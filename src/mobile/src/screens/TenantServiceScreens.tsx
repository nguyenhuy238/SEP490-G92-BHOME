import { IncidentReportForm } from '../features/incidents/IncidentReportForm';
import { IncidentListScreen } from '../features/incidents/IncidentScreens';
import React, { useState } from 'react';
import { Text } from 'react-native-paper';
import { Box, Heading, Pill } from '../components/WorkspaceKit';
import { ChoiceField, Input } from '../components/WorkflowControls';
import { QueryState, Pagination } from '../components/WorkspaceQueryState';
import { TenantEvidenceDraft } from '../components/TenantEvidenceDraft';
import { useTenantTenancy } from '../features/tenant/useTenantTenancy';

function TenancyChoice({ scope }: { scope: ReturnType<typeof useTenantTenancy> }) {
  return (
    <>
      <QueryState {...scope.contracts} />
      <ChoiceField
        label="Phòng / cơ sở của bạn"
        value={scope.current?.id ?? ''}
        options={scope.items.map((item) => ({
          id: item.id,
          label: `Phòng ${item.roomNumber} · ${item.locationName}`,
        }))}
        onChange={scope.select}
      />
      {!scope.contracts.loading && !scope.contracts.error && !scope.items.length && (
        <Text>Chưa có phòng thuộc hợp đồng đang hiệu lực trên trang này.</Text>
      )}
      {scope.contracts.data && (
        <Pagination
          page={scope.page}
          total={scope.contracts.data.totalCount}
          loading={scope.contracts.loading}
          onChange={scope.setPage}
        />
      )}
    </>
  );
}

export function TenantIncidentScreen() {
  return <IncidentReportForm />;
}
export function TenantRequestsScreen() {
  return <IncidentListScreen />;
}

export function TenantResidenceScreen() {
  const scope = useTenantTenancy(false);
  const [result, setResult] = useState('');
  const [reference, setReference] = useState('');
  return (
    <>
      <Heading title="Tạm trú qua VNeID" detail="Khách thuê đăng ký bên ngoài BHOME" />
      <TenancyChoice scope={scope} />
      <Box>
        <Heading title="Các bước thực hiện" />
        <Text>1. Mở ứng dụng VNeID chính thức trên thiết bị của bạn.</Text>
        <Text>
          2. Chuẩn bị thông tin chỗ ở và liên hệ chủ cơ sở để có thông tin hỗ trợ cần thiết.
        </Text>
        <Text>
          3. Thực hiện đăng ký qua VNeID theo hướng dẫn tại đó. Chủ cơ sở thực hiện xác nhận chỗ ở
          khi được yêu cầu.
        </Text>
        <Text>BHOME không nộp hồ sơ cho cơ quan nhà nước và nhân viên không đăng ký thay bạn.</Text>
      </Box>
      <Box>
        <Pill tone="amber">Chưa kết nối kết quả đăng ký</Pill>
        <Text>
          Máy chủ chưa cung cấp thông tin hỗ trợ cư trú, trạng thái, nơi lưu kết quả hoặc bằng
          chứng. Các thông tin nhập dưới đây chưa được gửi/lưu; chưa thể xác định trạng thái đăng ký
          của bạn.
        </Text>
        <Input label="Mã hồ sơ tham chiếu (bản nháp)" value={reference} onChange={setReference} />
        <Input label="Thông tin kết quả (bản nháp)" value={result} onChange={setResult} multiline />
      </Box>
      <TenantEvidenceDraft />
    </>
  );
}
