import { RentalContractFlow } from './RentalContractFlow';
import { HoldingContractFlow } from './HoldingContractFlow';
import { conciseMessage, showError } from '../../lib/toast';
import { useFeedbackState } from '../../lib/useFeedbackState';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalSearchParams, router } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { ActivityIndicator, Button, Checkbox, Text } from 'react-native-paper';
import { randomUUID } from '../../lib/randomUUID';
import {
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
import { ContractSigningPanel, signatureLine, useSigningMethods } from './ContractSigningPanel';
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
import { defaultStaffContractListView, isMainOnboardingDraft } from './staffContractList';
import { useWorkspaceHeaderRefresh } from '../../components/WorkspaceHeaderContext';
import { mobileContractActions } from './contractSections';
import { OwnerMainContractFlow } from '../owner/OwnerMainContractFlow';

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
    kind?: string;
  }>();
  const [mainDraftId, setMainDraftId] = useState('');
  const [createHolding, setCreateHolding] = useState(params.kind === 'Holding');
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
  const id = role === 'Owner' ? deepId : selected || deepId;
  const draftReference =
    role === 'Owner' ? params.mainDraftId || '' : mainDraftId || params.mainDraftId || '';
  let invalidOwnerRoute = role === 'Owner' && !!params.contractId && !deepId;
  if (role === 'Owner' && params.mainDraftId) {
    try {
      const draft = guid(params.mainDraftId);
      if (deepId && draft !== deepId) invalidOwnerRoute = true;
    } catch {
      invalidOwnerRoute = true;
    }
  }
  function openContract(contract: { id: string; onboardingDraft?: boolean }) {
    if (role === 'Owner') {
      setCreate(false);
      setMainDraftId('');
      setSelected('');
      router.setParams({
        contractId: contract.id,
        mainDraftId: contract.onboardingDraft ? contract.id : '',
        roomId: '',
      });
    } else if (contract.onboardingDraft) setMainDraftId(contract.id);
    else setSelected(contract.id);
  }
  const previousContracts = useRef<string[]>([]);
  const returnToList = useCallback(() => {
    previousContracts.current = [];
    setSelected('');
    setMainDraftId('');
    router.setParams({ contractId: '', mainDraftId: '' });
    setRevision((v) => v + 1);
  }, []);
  const backFromContract = useCallback(() => {
    const previous = previousContracts.current.pop();
    if (previous) {
      if (role === 'Owner') router.setParams({ contractId: previous, mainDraftId: '', roomId: '' });
      return setSelected(previous === deepId ? '' : previous);
    }
    if (deepId && !selected && router.canGoBack()) return router.back();
    returnToList();
  }, [deepId, selected, returnToList, role]);
  function released(next: string) {
    setCreateHolding(false);
    setCreate(false);
    setMainDraftId('');
    setSelected(next);
    setRevision((v) => v + 1);
    router.setParams({ mainDraftId: '', roomId: '', contractId: next, kind: '' });
  }
  if (!client || !session || !role) return <Text>Cần đăng nhập để xem hợp đồng.</Text>;
  if (invalidOwnerRoute)
    return <Text>Tham chiếu hợp đồng không hợp lệ. Hãy mở lại từ danh sách hợp đồng.</Text>;
  if (createHolding && ['Owner', 'Staff'].includes(role))
    return (
      <ContractDraftForm
        api={client}
        initialRoomId={params.roomId}
        onCancel={() => {
          setCreateHolding(false);
          setCreate(false);
          router.setParams({ kind: '' });
        }}
        onCreated={(next) => {
          setCreateHolding(false);
          released(next);
        }}
      />
    );
  if (
    (draftReference || ((create || role === 'Owner') && params.roomId)) &&
    ['Owner', 'Staff'].includes(role)
  ) {
    let references: {
      initialId?: string;
      roomId: string;
      representativeResidentId: string;
      residentIds: string[];
    } | null = null;
    try {
      const existing = draftReference;
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
      if (
        role === 'Owner' &&
        !existing &&
        (!references.roomId ||
          !references.representativeResidentId ||
          !references.residentIds.includes(references.representativeResidentId) ||
          new Set(references.residentIds).size !== references.residentIds.length)
      )
        throw new Error('invalid');
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
        onReleased={released}
        onCancel={() => {
          setCreate(false);
          setMainDraftId('');
          router.setParams({
            mainDraftId: '',
            roomId: '',
            ...(role === 'Owner' ? { contractId: '' } : {}),
          });
        }}
        onList={() => {
          setCreate(false);
          setMainDraftId('');
          setRevision((v) => v + 1);
          router.setParams({
            mainDraftId: '',
            roomId: '',
            ...(role === 'Owner' ? { contractId: '' } : {}),
          });
        }}
      />
    );
  }
  if (
    create &&
    ['Staff', 'Owner'].includes(role) &&
    (role !== 'Owner' || (!mainDraftId && !deepId) || mainDraftId === deepId)
  )
    return (
      <MainDraftStart
        owner={role === 'Owner'}
        onSaved={role === 'Owner' ? setMainDraftId : undefined}
        onReleased={released}
        api={client}
        onCancel={() => {
          setCreate(false);
          if (role === 'Owner') {
            setMainDraftId('');
            router.setParams({ contractId: '', mainDraftId: '', roomId: '' });
          }
        }}
        onList={() => {
          setCreate(false);
          setRevision((v) => v + 1);
          router.setParams({
            mainDraftId: '',
            roomId: '',
            ...(role === 'Owner' ? { contractId: '' } : {}),
          });
        }}
      />
    );
  if (id)
    return (
      <LiveContractDetail
        key={id}
        api={client}
        id={id}
        role={role}
        actorId={session.userId}
        initialSection={
          ['Tenant', 'Owner'].includes(role) &&
          contractSections.some((item) => item.id === params.section)
            ? (params.section as ContractSection)
            : 'overview'
        }
        onNext={(next) => {
          if (next && next !== id) previousContracts.current.push(id);
          setSelected(next);
          if (role === 'Owner') {
            setCreate(false);
            setMainDraftId('');
            router.setParams({ contractId: next, mainDraftId: '', roomId: '' });
          }
        }}
        onBack={backFromContract}
        onList={returnToList}
      />
    );
  if (role === 'Staff')
    return (
      <StaffContractsList
        api={client}
        viewState={staffListView}
        onViewStateChange={setStaffListView}
        onCreateHolding={() => setCreateHolding(true)}
        onOpen={(contract) => setSelected(contract.id)}
        onInspection={setSelected}
      />
    );
  return (
    <>
      <Heading
        title="Hợp đồng & Vòng đời"
        detail="Theo dõi hợp đồng trong phạm vi tài khoản của bạn."
      />
      {role === 'Owner' && (
        <>
          <Action
            onPress={() => {
              setMainDraftId('');
              setSelected('');
              setCreate(true);
              router.setParams({ contractId: '', mainDraftId: '', roomId: '' });
            }}
          >
            Tạo hợp đồng thuê
          </Action>
          <Action onPress={() => setCreateHolding(true)}>Tạo hợp đồng giữ chỗ</Action>
        </>
      )}
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
              <Action onPress={() => openContract(c)}>Xem hợp đồng</Action>
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
  onList,
  onBack,
  initialSection = 'overview',
}: {
  api: ReturnType<typeof contractClient>;
  id: string;
  role: string;
  actorId: string;
  onNext: (id: string) => void;
  onList: () => void;
  onBack: () => void;
  initialSection?: ContractSection;
}) {
  const detail = useContractDetail(api, id, role, 5000);
  useWorkspaceHeaderRefresh(detail.reload, detail.loading, {
    onBack,
    title: detail.data?.contract.kind === 'Holding' ? 'Hợp đồng giữ chỗ' : 'Hợp đồng',
  });
  const signingMethods = useSigningMethods(api);
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
  if (isMainOnboardingDraft(c) && ['Staff', 'Owner'].includes(role))
    return (
      <MainDraftScreen
        persistRoute={role !== 'Owner'}
        initialId={c.id}
        onReleased={(next) => {
          router.setParams({ mainDraftId: '', roomId: '', contractId: next });
          onNext(next);
          detail.reload();
        }}
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
  const rental =
    role !== 'Owner' &&
    c.kind === 'Main' &&
    ['Draft', 'PendingSigning', 'PendingActivation', 'Active'].includes(c.status);
  const holding =
    c.kind === 'Holding' &&
    ['Owner', 'Staff'].includes(role) &&
    ['Draft', 'PendingSigning', 'PendingActivation', 'Active'].includes(c.status);
  const availableEvidence = [...new Set([...(m?.evidenceIds ?? []), ...evidence])];
  const actions = mobileContractActions(c, m, role, actorId, signingMethods?.methods).filter(
    (item) =>
      (!holding ||
        ![
          'holding-approval',
          'holding-activation',
          'deposit-verifications',
          'signing',
          'signing/sync',
          'signing/recover',
        ].includes(item.operation)) &&
      (c.kind !== 'Holding' ||
        item.operation !== 'deposit-verifications' ||
        (!!c.approvedAt && !!r && !r.blockers.includes('verified_signature_evidence_required'))),
  );
  const action = actions.find((a) => a.operation === selectedAction);
  const signer =
    (role === 'Tenant' && c.tenantUserId === actorId) ||
    (c.kind === 'Holding' && role === 'Owner' && c.ownerSignerId === actorId);
  const ownerMain =
    role === 'Owner' &&
    c.kind === 'Main' &&
    !c.onboardingDraft &&
    ['Draft', 'PendingSigning', 'PendingActivation', 'Active'].includes(c.status) &&
    ['overview', 'signing'].includes(section);
  return (
    <>
      {!rental && !holding && !ownerMain && (
        <Heading
          title={`Phòng ${c.roomNumber || c.roomId}`}
          detail={`${text(c.kind)} · ${c.locationName ?? ''}`}
        />
      )}
      {!rental && c.isDevelopmentDemo && (
        <Text style={ui.red}>HỢP ĐỒNG DEMO · Dữ liệu minh họa, không dùng làm hợp đồng thật.</Text>
      )}
      {!holding && <Pill tone={c.status === 'Active' ? 'green' : 'amber'}>{text(c.status)}</Pill>}
      {!!detail.refreshError && (
        <Text style={ui.red}>Ch?a c?p nh?t ???c tr?ng th?i m?i. {detail.refreshError}</Text>
      )}
      {c.kind === 'Holding' ? (
        <View style={{ flexDirection: 'row', gap: 4 }}>
          {(
            [
              ['overview', 'Tổng quan'],
              ['signing', 'Ký hợp đồng'],
              ['history', 'Lịch sử'],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              compact
              style={{ flex: 1, minWidth: 0 }}
              labelStyle={{ fontSize: 12, marginHorizontal: 2 }}
              contentStyle={{ minHeight: 44 }}
              mode={section === key ? 'contained' : 'outlined'}
              accessibilityState={{ selected: section === key }}
              onPress={() => {
                setSection(key);
                setSelectedAction('');
              }}
            >
              {label}
            </Button>
          ))}
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {contractSections
            .filter((item) => c.kind !== 'Holding' || !['handover', 'lifecycle'].includes(item.id))
            .map((item) => (
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
        </ScrollView>
      )}
      {rental && (section === 'overview' || section === 'signing') && (
        <RentalContractFlow
          key={`${c.id}:${section}`}
          api={api}
          contract={c}
          readiness={r}
          role={role}
          actorId={actorId}
          onChanged={detail.reload}
          onList={onList}
        />
      )}
      {ownerMain && (
        <OwnerMainContractFlow
          api={api}
          contract={c}
          readiness={r}
          actorId={actorId}
          onChanged={detail.reload}
        />
      )}
      {holding && (section === 'overview' || section === 'signing') && (
        <HoldingContractFlow
          key={c.id}
          api={api}
          contract={c}
          readiness={r}
          role={role}
          actorId={actorId}
          onChanged={detail.reload}
          onList={onList}
        />
      )}
      {section === 'overview' && !rental && !holding && !ownerMain && c.kind !== 'Holding' && (
        <ContractProgress contract={c} readiness={r} />
      )}
      {!holding && (
        <Button
          disabled={uploading}
          onPress={() => {
            setSelectedAction('');
            detail.reload();
          }}
        >
          Tải lại trạng thái
        </Button>
      )}
      {!!notice && <Text style={ui.blue}>{notice}</Text>}
      {section === 'overview' && !rental && !holding && !ownerMain && (
        <>
          <Box>
            <Heading title={c.kind === 'Holding' ? 'Thông tin giữ chỗ' : 'Kỳ thuê & Người ở'} />
            <Text>
              Phòng {c.roomNumber || c.roomId}
              {c.locationName ? ` · ${c.locationName}` : ''}
            </Text>
            {c.kind !== 'Holding' && (
              <>
                <Text>
                  {displayContractDate(c.startDate)} – {displayContractDate(c.endDate)}
                </Text>
                <Text>Tiền thuê: {formatContractMoney(c.monthlyRent)} / tháng</Text>
              </>
            )}
            {c.actualEndDate && (
              <Text>Ngày kết thúc thực tế: {displayContractDate(c.actualEndDate)}</Text>
            )}
            <Text>
              {c.kind === 'Holding' ? 'Tiền giữ chỗ' : 'Cọc yêu cầu'}:{' '}
              {formatContractMoney(c.requiredDeposit)}
            </Text>
            {c.kind === 'Holding' && (
              <>
                <Text>
                  Hạn giữ chỗ: {c.holdingExpiresAt ? formatInstant(c.holdingExpiresAt) : '—'}
                </Text>
                <Text>Owner: {c.approvedAt ? 'Đã duyệt' : 'Chờ duyệt'}</Text>
                <Text>
                  Giá thuê được máy chủ xác định theo chính sách phòng. Phòng chỉ được giữ sau khi
                  Owner kích hoạt.
                </Text>
              </>
            )}
            {c.kind !== 'Holding' && (
              <Text>Cọc giữ chỗ áp dụng: {formatContractMoney(c.appliedHoldingDeposit)}</Text>
            )}
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
      {section === 'signing' && !rental && !holding && !ownerMain && (
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
                  <Text key={s.id}>{signatureLine(s, text)}</Text>
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
          {signer &&
            !c.isDevelopmentDemo &&
            !(role === 'Owner' && c.signingMode === 'INTERNAL_OTP_DRAWN') &&
            (!signingMethods || signingMethods.methods.includes('VIETTEL_MYSIGN')) && (
              <SigningCertificates api={api} />
            )}
        </Box>
      )}
      {section === 'signing' &&
        !rental &&
        !holding &&
        !ownerMain &&
        c.signingMode !== 'INTERNAL_OTP_DRAWN' && (
          <ContractSigningPanel
            api={api}
            contract={c}
            actorId={actorId}
            methods={signingMethods}
            onChanged={detail.reload}
          />
        )}
      {((section === 'signing' && !rental && !holding && !ownerMain) || section === 'history') && (
        <ContractWorkflowPanel
          api={api}
          contract={c}
          role={role}
          section={section === 'history' ? 'history' : 'documents'}
          readiness={r}
          onChanged={detail.reload}
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
      {section === 'signing' && !rental && !holding && role === 'Staff' && (
        <Text style={ui.muted}>
          Staff chuẩn bị và theo dõi hồ sơ. Owner/Tenant thực hiện ký; Owner xác minh cọc và kích
          hoạt.
        </Text>
      )}
      {section === 'signing' && !rental && !holding && !ownerMain && r && (
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
      {!ownerMain &&
        !(rental && section === 'signing') &&
        actions.some((a) => contractActionSection(a.operation) === section) && (
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
