import { conciseMessage, showError } from '../../lib/toast';
import { useFeedbackState } from '../../lib/useFeedbackState';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { View } from 'react-native';
import { ActivityIndicator, Button, Checkbox, Text } from 'react-native-paper';
import { randomUUID } from '../../lib/randomUUID';
import {
  contractActions,
  contractClient,
  contractError,
  contractStates,
  displayContractDate,
  formatContractMoney,
  guid,
  mutationKeys,
  text,
  type ContractPage,
} from '../../../../../packages/client-core/src/contracts';
import { useContractDetail } from '../../../../../packages/client-core/src/useContractDetail';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { useSession } from '../../lib/SessionProvider';
import { useWorkspace } from '../workspace/WorkspaceProvider';
import { Action, Box, Heading, Pill, Row, ui } from '../../components/WorkspaceKit';
import { ChoiceField } from '../../components/WorkflowControls';
import { ContractActionForm, SigningCertificates } from './ContractActionForm';
import { ContractDraftForm } from './ContractDraftForm';
import { MainDraftScreen } from './MainDraftScreen';
import { MainDraftStart } from './MainDraftStart';
import { CameraCapture } from '../../components/CameraCapture';
import { ContractEvidence } from './ContractEvidence';
import { ContractWorkflowPanel } from './ContractWorkflowPanel';
import { ContractHandoverPanel } from './ContractHandoverPanel';
import { ContractLifecyclePanel } from './ContractLifecyclePanel';
import { ContractExpiryPanel } from './ContractExpiryPanel';
import { ContractProgress } from './ContractProgress';
import {
  contractSections,
  contractActionSection,
  groupContracts,
  type ContractSection,
} from './contractSections';
import { StaffContractsList } from './StaffContractsList';
import { defaultStaffContractListView } from './staffContractList';

export function ContractScreen({ prepare = false }: { prepare?: boolean }) {
  const { api: transport, session } = useSession();
  const { role } = useWorkspace();
  const [staffListView, setStaffListView] = useState({ ...defaultStaffContractListView });
  const params = useLocalSearchParams<{
    contractId?: string;
    section?: string;
    mainDraftId?: string;
    roomId?: string;
    representativeResidentId?: string;
    residentIds?: string;
  }>();
  const [mainDraftId, setMainDraftId] = useState('');
  const [selected, setSelected] = useState(''),
    [create, setCreate] = useState(prepare);
  const [page, setPage] = useState(1),
    [filter, setFilter] = useState(''),
    [revision, setRevision] = useState(0);
  const [listing, setListing] = useState<{
    data: ContractPage | null;
    error: string;
    loading: boolean;
  }>({ data: null, error: '', loading: true });
  const client = useMemo(
    () =>
      transport ? contractClient((path, init, type) => transport.request(path, init, type)) : null,
    [transport],
  );
  useEffect(() => {
    if (!client || role === 'Staff') return;
    const controller = new AbortController();
    async function load() {
      setListing({ data: null, error: '', loading: true });
      try {
        const data = await client!.list(page, filter, '', controller.signal);
        if (!controller.signal.aborted) setListing({ data, error: '', loading: false });
      } catch (e) {
        if (!controller.signal.aborted) {
          const message = conciseMessage(contractError(e));
          setListing({ data: null, error: message, loading: false });
          showError(message);
        }
      }
    }
    void load();
    return () => controller.abort();
  }, [client, page, filter, revision, role]);
  let deepId = '';
  if (params.contractId) {
    try {
      deepId = guid(params.contractId);
    } catch {
      /* Do not send untrusted route text to an API path. */
    }
  }
  const id = selected || deepId;
  if (!client || !session || !role) return <Text>Cần đăng nhập để xem hợp đồng.</Text>;
  if (
    (mainDraftId || params.mainDraftId || (create && params.roomId)) &&
    ['Owner', 'Staff'].includes(role)
  ) {
    let references: {
      initialId?: string;
      roomId: string;
      representativeResidentId: string;
      residentIds: string[];
    } | null = null;
    try {
      const existing = mainDraftId || params.mainDraftId;
      const residents: unknown = JSON.parse(params.residentIds ?? '[]');
      if (!Array.isArray(residents)) throw new Error('invalid');
      references = {
        initialId: existing ? guid(existing) : undefined,
        roomId: params.roomId ? guid(params.roomId) : '',
        representativeResidentId: params.representativeResidentId
          ? guid(params.representativeResidentId)
          : '',
        residentIds: residents.map((value) => guid(String(value))),
      };
    } catch {
      /* Invalid route references do not reach the API. */
    }
    if (!references)
      return (
        <Text>Tham chiếu hồ sơ không hợp lệ. Hãy mở lại từ tiếp nhận hoặc danh sách hợp đồng.</Text>
      );
    return (
      <MainDraftScreen
        {...references}
        onCancel={() => {
          setCreate(false);
          setMainDraftId('');
          router.setParams({ mainDraftId: '', roomId: '' });
        }}
        onList={() => {
          setCreate(false);
          setMainDraftId('');
          setRevision((v) => v + 1);
          router.setParams({ mainDraftId: '', roomId: '' });
        }}
      />
    );
  }
  if (create && role === 'Staff')
    return (
      <MainDraftStart
        api={client}
        onCancel={() => setCreate(false)}
        onList={() => {
          setCreate(false);
          setRevision((v) => v + 1);
          router.setParams({ mainDraftId: '', roomId: '' });
        }}
      />
    );
  if (create && ['Owner', 'Staff'].includes(role))
    return (
      <ContractDraftForm
        api={client}
        onCancel={() => setCreate(false)}
        onCreated={(next) => {
          setCreate(false);
          setSelected(next);
          setRevision((v) => v + 1);
        }}
      />
    );
  if (id)
    return (
      <>
        <Action
          secondary
          onPress={() => {
            setSelected('');
            if (deepId) router.setParams({ contractId: '' });
            setRevision((v) => v + 1);
          }}
        >
          Về danh sách hợp đồng
        </Action>
        <LiveContractDetail
          key={id}
          api={client}
          id={id}
          role={role}
          actorId={session.userId}
          initialSection={
            role === 'Tenant' && contractSections.some((item) => item.id === params.section)
              ? (params.section as ContractSection)
              : 'overview'
          }
          onNext={setSelected}
        />
      </>
    );
  if (role === 'Staff')
    return (
      <StaffContractsList
        api={client}
        viewState={staffListView}
        onViewStateChange={setStaffListView}
        onCreate={() => setCreate(true)}
        onOpen={(contract) =>
          contract.onboardingDraft ? setMainDraftId(contract.id) : setSelected(contract.id)
        }
        onInspection={setSelected}
      />
    );
  return (
    <>
      <Heading
        title="Hợp đồng & Vòng đời"
        detail="Theo dõi hợp đồng trong phạm vi tài khoản của bạn."
      />
      {['Owner', 'Tenant'].includes(role) && (
        <ContractExpiryPanel api={client} onOpen={setSelected} />
      )}
      <ChoiceField
        label="Trạng thái hợp đồng"
        value={filter}
        options={[
          { id: '', label: 'Tất cả trạng thái' },
          ...contractStates.map((s) => ({ id: s, label: text(s) })),
        ]}
        onChange={(v) => {
          setFilter(v);
          setPage(1);
        }}
      />
      <Row>
        <Button disabled={listing.loading} onPress={() => setRevision((v) => v + 1)}>
          Tải lại
        </Button>
        {['Owner', 'Staff'].includes(role) && (
          <Button onPress={() => setCreate(true)}>Tạo nháp hợp đồng thuê</Button>
        )}
      </Row>
      {listing.loading && <ActivityIndicator accessibilityLabel="Đang tải hợp đồng" />}
      {!!listing.error && <Text style={ui.red}>{conciseMessage(listing.error)}</Text>}
      {!listing.loading && !listing.error && !listing.data?.items.length && (
        <Box>
          <Text>Chưa có hợp đồng phù hợp trong phạm vi tài khoản.</Text>
        </Box>
      )}
      {groupContracts(listing.data?.items ?? []).map((group) => (
        <View key={group.id} style={{ gap: 12 }}>
          <Heading title={group.title} detail={`${group.items.length} hợp đồng trên trang`} />
          {group.items.map((c) => (
            <Box key={c.id}>
              <Heading title={`Phòng ${c.roomNumber}`} detail={c.locationName} />
              <Pill>{text(c.status)}</Pill>
              <Text>
                {text(c.kind)} · {displayContractDate(c.startDate)} –{' '}
                {displayContractDate(c.endDate)}
              </Text>
              <Text style={ui.money}>{formatContractMoney(c.monthlyRent)} / tháng</Text>
              <Action
                onPress={() => (c.onboardingDraft ? setMainDraftId(c.id) : setSelected(c.id))}
              >
                Xem hợp đồng
              </Action>
            </Box>
          ))}
        </View>
      ))}
      {!!listing.data && (
        <Row spread>
          <Button disabled={listing.loading || page <= 1} onPress={() => setPage((v) => v - 1)}>
            Trước
          </Button>
          <Text>
            Trang {page} · {listing.data.totalCount} hợp đồng
          </Text>
          <Button
            disabled={listing.loading || page * 20 >= listing.data.totalCount}
            onPress={() => setPage((v) => v + 1)}
          >
            Sau
          </Button>
        </Row>
      )}
    </>
  );
}

function LiveContractDetail({
  api,
  id,
  role,
  actorId,
  onNext,
  initialSection = 'overview',
}: {
  api: ReturnType<typeof contractClient>;
  id: string;
  role: string;
  actorId: string;
  onNext: (id: string) => void;
  initialSection?: ContractSection;
}) {
  const detail = useContractDetail(api, id, role);
  const [selectedAction, setSelectedAction] = useState('');
  const [section, setSection] = useState<ContractSection>(initialSection);
  const [keys] = useState(() => mutationKeys(randomUUID));
  const [evidence, setEvidence] = useState<string[]>([]);
  const [evidenceText, setEvidenceText] = useState(''),
    [uploading, setUploading] = useState(false),
    [uploadChecked, setUploadChecked] = useState(false);
  const uploadLock = useRef(false);
  const [notice, setNotice] = useFeedbackState('success');
  if (detail.loading) return <ActivityIndicator accessibilityLabel="Đang tải chi tiết hợp đồng" />;
  if (detail.error)
    return (
      <Box>
        <Text style={ui.red}>{conciseMessage(detail.error)}</Text>
        <Action onPress={detail.reload}>Tải lại hợp đồng</Action>
      </Box>
    );
  if (!detail.data) return null;
  const { contract: c, moveOut: m, readiness: r, history } = detail.data;
  if (c.onboardingDraft)
    return (
      <MainDraftScreen
        initialId={c.id}
        roomId={c.roomId}
        representativeResidentId={c.representativeResidentId}
        residentIds={c.residentIds}
        onCancel={() => {
          router.setParams({ contractId: '', mainDraftId: '' });
          onNext('');
        }}
        onList={() => {
          router.setParams({ contractId: '', mainDraftId: '' });
          onNext('');
        }}
      />
    );
  const availableEvidence = [...new Set([...(m?.evidenceIds ?? []), ...evidence])];
  const actions = contractActions(c, m, role, actorId).filter(
    (a) => !['move-out/inspection', 'move-out/settlement'].includes(a.operation),
  );
  const action = actions.find((a) => a.operation === selectedAction);
  const signer =
    ['Owner', 'Tenant'].includes(role) && [c.ownerSignerId, c.tenantUserId].includes(actorId);
  return (
    <>
      <Heading
        title={`Phòng ${c.roomNumber || c.roomId}`}
        detail={`${text(c.kind)} · ${c.locationName ?? ''}`}
      />
      {c.isDevelopmentDemo && (
        <Text style={ui.red}>HỢP ĐỒNG DEMO · Dữ liệu minh họa, không dùng làm hợp đồng thật.</Text>
      )}
      <Pill tone={c.status === 'Active' ? 'green' : 'amber'}>{text(c.status)}</Pill>
      <View style={ui.wrap}>
        {contractSections.map((item) => (
          <Button
            key={item.id}
            mode={section === item.id ? 'contained' : 'outlined'}
            contentStyle={{ minHeight: 44 }}
            disabled={uploading}
            accessibilityState={{ selected: section === item.id }}
            onPress={() => {
              setSection(item.id);
              setSelectedAction('');
            }}
          >
            {item.label}
          </Button>
        ))}
      </View>
      {section === 'overview' && <ContractProgress contract={c} readiness={r} />}
      <Button
        disabled={uploading}
        onPress={() => {
          setSelectedAction('');
          detail.reload();
        }}
      >
        Tải lại trạng thái
      </Button>
      {!!notice && <Text style={ui.blue}>{notice}</Text>}
      {section === 'overview' && (
        <>
          <Box>
            <Heading title="Kỳ thuê & Người ở" />
            <Text>
              Phòng {c.roomNumber || c.roomId}
              {c.locationName ? ` · ${c.locationName}` : ''}
            </Text>
            <Text>
              {displayContractDate(c.startDate)} – {displayContractDate(c.endDate)}
            </Text>
            <Text>Tiền thuê: {formatContractMoney(c.monthlyRent)} / tháng</Text>
            {c.actualEndDate && (
              <Text>Ngày kết thúc thực tế: {displayContractDate(c.actualEndDate)}</Text>
            )}
            <Text>Cọc yêu cầu: {formatContractMoney(c.requiredDeposit)}</Text>
            <Text>Cọc giữ chỗ áp dụng: {formatContractMoney(c.appliedHoldingDeposit)}</Text>
            <Text>
              {c.residentIds.length} người ở · Đại diện:{' '}
              {c.occupants?.find((o) => o.representative)?.label || c.representativeResidentId}
            </Text>
            {!!c.occupants?.length && <Text>{c.occupants.map((o) => o.label).join(', ')}</Text>}
            {c.previousContractId && (
              <Button onPress={() => onNext(c.previousContractId!)}>Xem hợp đồng trước</Button>
            )}
          </Box>
          <Box>
            <Heading title="Điều khoản đưa đi ký" />
            <Text selectable>{c.terms}</Text>
          </Box>
        </>
      )}
      {section === 'signing' && (
        <Box>
          <Heading title="Chữ ký và bằng chứng" />
          {[
            { id: c.ownerSignerId, label: 'Owner' },
            { id: c.tenantUserId, label: 'Tenant' },
          ].map((s) => (
            <View key={s.id} style={ui.soft}>
              <Text variant="titleSmall">
                {s.label}
                {s.id === actorId ? ' (bạn)' : ''}
              </Text>
              {c.signatures
                .filter((x) => x.signerUserId === s.id)
                .map((s) => (
                  <Text key={s.id}>
                    {text(s.status)}
                    {s.signedAt ? ` · ${formatInstant(s.signedAt)}` : ''}
                  </Text>
                ))}
              {!c.signatures.some((x) => x.signerUserId === s.id) && (
                <Text>Chưa có yêu cầu ký</Text>
              )}
            </View>
          ))}
          {['Owner', 'Tenant'].includes(role) &&
            c.signatures.some((s) => ['Signed', 'Simulated'].includes(s.status)) && (
              <ContractEvidence api={api} contractId={id} pdf />
            )}
          {signer && !c.isDevelopmentDemo && <SigningCertificates api={api} />}
        </Box>
      )}
      {(section === 'signing' || section === 'history') && (
        <ContractWorkflowPanel
          api={api}
          contract={c}
          role={role}
          section={section === 'history' ? 'history' : 'documents'}
        />
      )}
      {section === 'handover' && ['Active', 'Terminated', 'Superseded'].includes(c.status) && (
        <ContractHandoverPanel api={api} contract={c} role={role} />
      )}
      {section === 'handover' && !['Active', 'Terminated', 'Superseded'].includes(c.status) && (
        <Box>
          <Heading title="Bàn giao nhận phòng" />
          <Text>Chỉ thực hiện bàn giao sau khi hợp đồng được kích hoạt.</Text>
        </Box>
      )}
      {section === 'signing' && role === 'Staff' && (
        <Text style={ui.muted}>
          Staff chuẩn bị và theo dõi hồ sơ. Owner/Tenant thực hiện ký; Owner xác minh cọc và kích
          hoạt.
        </Text>
      )}
      {section === 'signing' && r && (
        <Box>
          <Heading title="Điều kiện kích hoạt" />
          <Text>Cọc đã xác minh: {formatContractMoney(r.verifiedDeposit)}</Text>
          <Text>Cọc còn thiếu: {formatContractMoney(r.remainingDeposit)}</Text>
          {r.ready ? (
            <Pill tone="green">Đủ điều kiện để Owner kích hoạt</Pill>
          ) : (
            r.blockers.map((b) => (
              <Text key={b} style={ui.red}>
                • {text(b)}
              </Text>
            ))
          )}
        </Box>
      )}
      {section === 'lifecycle' && !m && (
        <Box>
          <Heading title="Gia hạn & trả phòng" />
          <Text>
            Chưa có yêu cầu trả phòng. Các thao tác khả dụng hiển thị theo trạng thái và quyền tài
            khoản.
          </Text>
        </Box>
      )}
      {section === 'lifecycle' && m && (
        <Box>
          <Heading title="Trả phòng" detail={text(m.status)} />
          <Text>Ngày đề nghị: {displayContractDate(m.proposedDate)}</Text>
          <Text>Lý do: {m.reason}</Text>
          {m.inspectionScheduledAt && (
            <Text>Lịch kiểm tra: {formatInstant(m.inspectionScheduledAt)} (giờ Việt Nam)</Text>
          )}
          {!!m.pendingReason && <Text style={ui.red}>{text(m.pendingReason)}</Text>}
          {m.inspectionNotes && <Text>Biên bản: {m.inspectionNotes}</Text>}
          {m.inspectedAt && <Text>Lập lúc: {formatInstant(m.inspectedAt)}</Text>}
          {m.electricityReadingId && (
            <Text selectable>Mã chỉ số điện: {m.electricityReadingId}</Text>
          )}
          {m.waterReadingId && <Text selectable>Mã chỉ số nước: {m.waterReadingId}</Text>}
          {(m.evidenceIds ?? []).map((e, i) => (
            <ContractEvidence key={e} api={api} contractId={id} evidenceId={e} number={i + 1} />
          ))}
        </Box>
      )}
      {section === 'lifecycle' && role === 'Staff' && m?.status === 'Approved' && (
        <Box>
          <Heading
            title="Ảnh hiện trạng trả phòng"
            detail="Tối đa 5 ảnh PNG/JPEG, mỗi ảnh tối đa 5 MB"
          />
          <Text>
            Ảnh chỉ ghi nhận hiện trạng phòng và tài sản. Không chụp CCCD hoặc giấy tờ cá nhân.
          </Text>
          <Checkbox.Item
            label="Tôi đã kiểm tra ảnh không có giấy tờ cá nhân"
            status={uploadChecked ? 'checked' : 'unchecked'}
            onPress={() => setUploadChecked((v) => !v)}
          />
          <CameraCapture
            label="Chụp và tải ảnh hiện trạng"
            reviewActionLabel="Tải ảnh trả phòng"
            reviewNotice="Ảnh được lưu riêng tư làm bằng chứng trả phòng; ảnh tạm trên thiết bị được xóa sau khi tải hoặc rời màn hình. Không chụp giấy tờ cá nhân."
            disabled={uploading || !uploadChecked || evidence.length >= 5}
            reviewBeforeSubmit
            onCapture={async (bytes) => {
              if (uploadLock.current) return;
              uploadLock.current = true;
              setUploading(true);
              setEvidenceText('');
              try {
                if (bytes.byteLength > 5 * 1024 * 1024) throw new Error('Ảnh vượt quá 5 MB.');
                const result = await api.upload(id, bytes, 'image/jpeg');
                setEvidence((ids) => [...ids, result.id]);
                setEvidenceText('Đã tải ảnh. Hãy chọn ảnh này khi lưu biên bản.');
              } catch (e) {
                setEvidenceText(
                  e instanceof Error && e.message === 'Ảnh vượt quá 5 MB.'
                    ? e.message
                    : contractError(e),
                );
              } finally {
                uploadLock.current = false;
                setUploading(false);
                setUploadChecked(false);
              }
            }}
          />
          <Text>{availableEvidence.length} ảnh hiện trạng khả dụng cho bạn</Text>
          {!!evidenceText && <Text>{evidenceText}</Text>}
          {evidence
            .filter((e) => !(m.evidenceIds ?? []).includes(e))
            .map((e, i) => (
              <ContractEvidence key={e} api={api} contractId={id} evidenceId={e} number={i + 1} />
            ))}
          <Button onPress={() => router.push('/capture')}>
            Mở tác vụ điện / nước để ghi chỉ số chốt
          </Button>
          <Text variant="bodySmall">
            Owner tạo tác vụ Final đúng hợp đồng. Sau khi xác nhận chỉ số, sao chép mã reading vào
            biên bản.
          </Text>
        </Box>
      )}
      {section === 'lifecycle' && !!history.length && (
        <Box>
          <Heading title="Lịch sử xem xét quyết toán" />
          {history.map((h) => (
            <View key={h.id} style={ui.soft}>
              <Text>
                {formatInstant(h.reviewedAt)} · {h.settled ? 'Đã xác minh' : 'Còn chờ đối chiếu'}
              </Text>
              <Text>{h.decision}</Text>
            </View>
          ))}
        </Box>
      )}
      {section === 'lifecycle' && m && (
        <ContractLifecyclePanel
          api={api}
          id={id}
          role={role}
          moveOut={m}
          evidenceIds={availableEvidence}
          onChanged={() => {
            setEvidence([]);
            detail.reload();
          }}
        />
      )}
      {actions.some((a) => contractActionSection(a.operation) === section) && (
        <Box>
          <Heading title="Thao tác theo trạng thái" />
          {actions
            .filter((a) => contractActionSection(a.operation) === section)
            .map((a) => (
              <Action
                key={a.operation}
                disabled={
                  uploading ||
                  (['activate', 'holding-activation'].includes(a.operation) && !r?.ready)
                }
                secondary={!['activate', 'holding-activation'].includes(a.operation)}
                onPress={() => {
                  setSelectedAction(a.operation);
                  setNotice('');
                }}
              >
                {a.label}
              </Action>
            ))}
        </Box>
      )}
      {action && (
        <ContractActionForm
          key={action.operation}
          api={api}
          action={action}
          contract={c}
          keys={keys}
          evidenceIds={availableEvidence}
          onCancel={() => {
            setSelectedAction('');
            detail.reload();
          }}
          onSuccess={(next) => {
            setSelectedAction('');
            setNotice('Máy chủ đã ghi nhận thao tác. Trạng thái đã được yêu cầu tải lại.');
            detail.reload();
            if (next) onNext(next);
          }}
        />
      )}
    </>
  );
}
