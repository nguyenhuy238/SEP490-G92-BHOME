import React, { useEffect, useRef, useState } from 'react';
import { AppState, Platform, View } from 'react-native';
import { ActivityIndicator, Button, Checkbox, Icon, Text, TextInput } from 'react-native-paper';
import {
  usePreventScreenCapture,
  enableAppSwitcherProtectionAsync,
  disableAppSwitcherProtectionAsync,
} from 'expo-screen-capture';
import { CameraCapture } from '../../components/CameraCapture';
import { Action, Box, Filters, Heading, Pill, Row, ui } from '../../components/WorkspaceKit';
import { useSession } from '../../lib/SessionProvider';
import { errorMessage, type Proposal } from '../../lib/api';
import {
  confirmedIdentity,
  emptyIdentity,
  identityFields,
  mergeIdentity,
  type IdentityFields,
} from '../../lib/identity';
import { colors as c } from '../../theme/theme';
import { useWorkspace } from '../workspace/WorkspaceProvider';

interface Props {
  residentId: string;
  preview?: boolean;
  onComplete: () => void;
  onCancel: () => void;
}
export function IdentityWizard({ residentId, preview = false, onComplete, onCancel }: Props) {
  const { resetScroll } = useWorkspace();
  const { api, session } = useSession();
  const [step, setStep] = useState<'capture' | 'verify' | 'done'>('capture');
  const [side, setSide] = useState<'front' | 'back'>('front');
  const [sides, setSides] = useState<string[]>([]);
  const [fields, setFields] = useState(emptyIdentity);
  const [sources, setSources] = useState<Partial<Record<keyof IdentityFields, string>>>({});
  const current = useRef(fields);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  usePreventScreenCapture('identity-wizard');
  useEffect(() => {
    if (Platform.OS === 'ios') void enableAppSwitcherProtectionAsync().catch(() => {});
    const clear = () => {
      generation.current++;
      abort.current?.abort();
      current.current = emptyIdentity();
      setFields(emptyIdentity());
      setSources({});
      setChecked(false);
      setSides([]);
      setNotice(
        'Thông tin tạm đã xóa khi ứng dụng rời trạng thái hoạt động. Hãy chụp lại hoặc nhập thủ công.',
      );
    };
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') clear();
    });
    const invalidate = () => {
      generation.current++;
      abort.current?.abort();
      current.current = emptyIdentity();
    };
    return () => {
      invalidate();
      sub.remove();
      if (Platform.OS === 'ios') void disableAppSwitcherProtectionAsync().catch(() => {});
    };
  }, []);
  const acceptProposal = (proposal: Proposal, scannedSide: string) => {
    const merged = mergeIdentity(current.current, proposal);
    current.current = merged.fields;
    setFields(merged.fields);
    setChecked(false);
    setSources((before) => ({
      ...Object.fromEntries(
        identityFields
          .filter(([key]) => proposal.proposedFields[key])
          .map(([key]) => [key, 'Đề xuất OCR']),
      ),
      ...before,
    }));
    setSides((before) => [...new Set([...before, scannedSide])]);
    setNotice(
      proposal.isFallback
        ? 'OCR không đọc đủ dữ liệu. Chụp lại hoặc chuyển sang nhập thủ công.'
        : `Đã nhận đề xuất, chưa xác minh. ${merged.conflicts.length ? 'Có trường xung đột giữa hai mặt; giữ giá trị cũ để Staff đối chiếu.' : ''} ${proposal.warnings.length || proposal.missingFields.length ? 'Có cảnh báo hoặc thiếu trường. Hãy kiểm tra toàn bộ.' : ''}`,
    );
  };
  const scan = async (bytes: Uint8Array<ArrayBuffer>) => {
    if (!api || lock.current || preview) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setChecked(false);
    const epoch = generation.current;
    const controller = new AbortController();
    abort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const proposal = await api.image<Proposal>(
        `/api/v1/ocr/identity/${residentId}/${side}`,
        bytes,
        controller.signal,
      );
      if (epoch === generation.current) acceptProposal(proposal, side);
    } catch (e) {
      if (epoch === generation.current) {
        setError(errorMessage(e));
        setNotice('OCR chưa thành công; nhập thủ công vẫn khả dụng.');
      }
    } finally {
      clearTimeout(timeout);
      lock.current = false;
      setBusy(false);
    }
  };
  const save = async () => {
    if (lock.current || !checked) return;
    let input: ReturnType<typeof confirmedIdentity>;
    try {
      input = confirmedIdentity(current.current);
    } catch {
      setError('Số CCCD cần 12 chữ số; họ tên và ngày sinh hợp lệ. Ngày theo dd/MM/yyyy.');
      return;
    }
    if (!preview && (!api || !session?.roles.includes('Staff'))) {
      setError('Chỉ Staff được phân công mới được lưu thông tin.');
      return;
    }
    setBusy(true);
    lock.current = true;
    setError('');
    const epoch = generation.current;
    const controller = new AbortController();
    abort.current = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      if (!preview)
        await api!.json(
          `/api/v1/capture/residents/${residentId}/confirm`,
          input,
          controller.signal,
        );
      if (epoch !== generation.current) return;
      current.current = emptyIdentity();
      setFields(emptyIdentity());
      setSources({});
      setChecked(false);
      setStep('done');
      resetScroll();
    } catch (e) {
      if (epoch === generation.current) setError(errorMessage(e));
    } finally {
      clearTimeout(timeout);
      lock.current = false;
      setBusy(false);
    }
  };
  if (!preview && !session?.roles.includes('Staff'))
    return (
      <Box>
        <Heading title="Không có quyền xác nhận CCCD" />
        <Text>Chỉ Staff thuộc cơ sở được phân công được thực hiện thao tác này.</Text>
        <Action onPress={onCancel}>Quay lại</Action>
      </Box>
    );
  if (step === 'done')
    return (
      <Box>
        <Icon source="check-decagram-outline" color={c.green} size={48} />
        <Heading title={preview ? 'Hoàn tất bản xem trước' : 'Đã lưu thông tin Staff xác nhận'} />
        <Text>
          {preview
            ? 'Mô phỏng thành công; chưa gửi hồ sơ hoặc thay đổi dữ liệu tại máy chủ.'
            : 'Máy chủ đã xác nhận lưu các trường định danh được phép và metadata xác minh.'}
        </Text>
        <Text>
          Ảnh tạm đã được xóa khỏi thiết bị sau OCR. Đây không phải xác thực chip hoặc xác minh của
          cơ quan nhà nước.
        </Text>
        <Action icon="arrow-right" onPress={onComplete}>
          Về danh sách người ở
        </Action>
      </Box>
    );
  return (
    <>
      <Heading
        title={step === 'capture' ? 'Chụp CCCD hai mặt' : 'Kiểm tra & Xác nhận OCR'}
        detail="UC-13 • Thông tin định danh được giới hạn quyền truy cập"
      />
      <Row>
        <Pill tone={step === 'capture' ? 'blue' : 'green'}>1. Chụp giấy tờ</Pill>
        <Pill tone={step === 'verify' ? 'blue' : 'neutral'}>2. Kiểm tra & Lưu</Pill>
      </Row>
      <Box style={{ backgroundColor: c.tint }}>
        <Row>
          <Icon source="shield-lock-outline" size={26} color={c.blue} />
          <Text variant="bodySmall" style={ui.grow}>
            Ảnh CCCD chỉ phục vụ OCR tạm thời. Không tải vào kho ảnh, không giữ ảnh làm hồ sơ. Khi
            rời ứng dụng, dữ liệu chưa lưu được xóa.
          </Text>
        </Row>
      </Box>
      {step === 'capture' ? (
        <Box>
          <Filters
            options={['Mặt trước', 'Mặt sau']}
            selected={side === 'front' ? 'Mặt trước' : 'Mặt sau'}
            onChange={(value) => {
              if (!busy) setSide(value === 'Mặt trước' ? 'front' : 'back');
            }}
          />
          <View
            style={{
              padding: 24,
              backgroundColor: c.soft,
              borderRadius: 12,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: c.blue,
              alignItems: 'center',
              gap: 12,
            }}
          >
            <Icon
              source={side === 'front' ? 'card-account-details-outline' : 'card-text-outline'}
              size={64}
              color={c.primary}
            />
            <Text variant="titleMedium">
              {side === 'front' ? 'MẶT TRƯỚC CCCD' : 'MẶT SAU CCCD'}
            </Text>
            <Text variant="bodySmall" style={ui.muted}>
              Đặt đủ 4 góc trong khung, đủ sáng, không lóa. Giữ khoảng cách để chữ rõ.
            </Text>
            <Pill tone={sides.includes(side) ? 'green' : 'neutral'}>
              {sides.includes(side) ? 'Đã nhận đề xuất OCR' : 'Chưa xử lý mặt này'}
            </Pill>
          </View>
          {preview ? (
            <>
              <Action
                icon="text-recognition"
                onPress={() =>
                  acceptProposal(
                    {
                      proposedFields:
                        side === 'front'
                          ? {
                              citizenIdentityNumber: '000000000001',
                              fullName: 'CƯ DÂN MẪU',
                              dateOfBirth: '2000-01-01',
                              gender: 'Nam',
                              nationality: 'Việt Nam',
                            }
                          : {
                              residentialAddress: 'Địa chỉ giả lập, không phải dữ liệu cá nhân',
                              placeOfOrigin: 'Địa phương mẫu',
                              dateOfIssue: '2023-01-01',
                              dateOfExpiry: '2030-01-01',
                            },
                      warnings: [],
                      missingFields: [],
                      confidence: {},
                      isFallback: false,
                      requiresConfirmation: true,
                    },
                    side,
                  )
                }
              >
                Nhận đề xuất OCR mẫu {side === 'front' ? 'mặt trước' : 'mặt sau'}
              </Action>
              <Button
                textColor={c.red}
                onPress={() => {
                  setError('Mô phỏng: OCR không đọc được ảnh.');
                  setNotice('Bạn có thể chụp lại hoặc nhập thủ công.');
                }}
              >
                Thử trạng thái OCR thất bại
              </Button>
            </>
          ) : (
            <CameraCapture
              key={side}
              label={`Mở camera ${side === 'front' ? 'mặt trước' : 'mặt sau'}`}
              documentSide={side}
              disabled={busy}
              reviewBeforeSubmit
              onCapture={scan}
            />
          )}
          <Action
            secondary
            icon="pencil-outline"
            onPress={() => {
              setStep('verify');
              resetScroll();
              setChecked(false);
            }}
          >
            Nhập thủ công / Kiểm tra thông tin
          </Action>
          {side === 'front' && (
            <Button disabled={busy} onPress={() => setSide('back')}>
              Tiếp tục chụp mặt sau
            </Button>
          )}
        </Box>
      ) : (
        <Box>
          <Pill tone="amber">Đề xuất chưa xác nhận • Staff phải đối chiếu giấy tờ</Pill>
          {identityFields.map(([key, label]) => (
            <View key={key} style={{ gap: 4 }}>
              <TextInput
                mode="outlined"
                label={`${label}${['citizenIdentityNumber', 'fullName', 'dateOfBirth'].includes(key) ? ' *' : ''}`}
                value={fields[key]}
                disabled={busy}
                keyboardType={key === 'citizenIdentityNumber' ? 'number-pad' : 'default'}
                onChangeText={(value) => {
                  const next = { ...current.current, [key]: value };
                  current.current = next;
                  setFields(next);
                  setChecked(false);
                  setSources((before) => ({ ...before, [key]: 'Staff nhập / chỉnh sửa' }));
                }}
              />
              <Text variant="labelSmall" style={ui.muted}>
                {sources[key] ?? 'Chưa có dữ liệu • Có thể nhập thủ công'}
              </Text>
            </View>
          ))}
          <Checkbox.Item
            label="Tôi đã đối chiếu giấy tờ gốc và xác nhận toàn bộ thông tin"
            status={checked ? 'checked' : 'unchecked'}
            onPress={() => setChecked(!checked)}
            disabled={busy}
          />
          <Action
            icon="shield-check-outline"
            disabled={!checked || busy}
            onPress={() => void save()}
          >
            {preview ? 'Xác nhận bản mẫu (không lưu máy chủ)' : 'Xác nhận và lưu thông tin'}
          </Action>
          <Button
            disabled={busy}
            onPress={() => {
              setChecked(false);
              setStep('capture');
              resetScroll();
            }}
          >
            Quay lại chụp / Chụp lại
          </Button>
        </Box>
      )}
      {busy && (
        <Row>
          <ActivityIndicator />
          <Text>Đang xử lý an toàn…</Text>
          <Button onPress={() => abort.current?.abort()}>Hủy yêu cầu</Button>
        </Row>
      )}
      {!!notice && (
        <Text variant="bodySmall" style={ui.blue}>
          {notice}
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={ui.red}>
          {error}
        </Text>
      )}
      <Button disabled={busy} onPress={onCancel}>
        Quay lại hồ sơ cư dân
      </Button>
    </>
  );
}
