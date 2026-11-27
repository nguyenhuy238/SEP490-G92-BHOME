import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import {
  displayContractDate,
  formatContractMoney,
  type ContractClient,
  type HandoverAsset,
  type PreviewDocument,
} from '../../../../../packages/client-core/src/contracts';
import { handoverAssetSummary } from '../../../../../packages/client-core/src/handoverForm';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import {
  moveInMissingMessage,
  roomHandoverChecks,
  type MoveInDraft,
  type MoveInRoomCheck,
} from '../../services/moveInHandover';
import { colors } from '../../theme/theme';
import { Pill } from '../../components/WorkspaceKit';
import { ContractEvidence } from './ContractEvidence';

type Section = 'room' | 'meters' | 'assets' | 'keys' | 'documents' | 'contract';
type Detail = { section: Section; item?: string } | null;

const statusLabels: Record<MoveInDraft['status'], string> = {
  Draft: 'Đang chuẩn bị',
  PendingOwnerReview: 'Chờ chủ trọ duyệt',
  ReinspectionRequested: 'Cần kiểm tra lại',
  Ready: 'Sẵn sàng bàn giao',
  ChangesRequested: 'Đang xử lý chỉnh sửa',
  Confirmed: 'Đã xác nhận',
};

// Match the PDF's integer-only presentation. Never round or mutate the stored reading.
function displayMeterReading(value: string | number | undefined): string {
  if (value === undefined || value === null || value === '') return '—';
  const reading = Number(value);
  return Number.isFinite(reading) ? Math.trunc(reading).toLocaleString('vi-VN') : String(value);
}

const styles = StyleSheet.create({
  root: { gap: 14, minWidth: 0 },
  intro: { gap: 7 },
  heading: { fontSize: 18, fontWeight: '700', color: colors.navy },
  subtle: { fontSize: 12, lineHeight: 18, color: colors.muted },
  summary: { flexDirection: 'row', gap: 12, alignItems: 'center', flexWrap: 'wrap' },
  summaryText: { fontSize: 13, color: colors.navy },
  group: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  groupTitle: { fontSize: 13, fontWeight: '700', color: colors.navy, marginBottom: 8 },
  listRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 12,
  },
  listText: { flex: 1, minWidth: 0, gap: 2 },
  rowLabel: { fontWeight: '600', fontSize: 14, color: colors.navy },
  rowDetail: { fontSize: 12, color: colors.muted, lineHeight: 17 },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginHorizontal: 12,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'rgba(14, 27, 47, 0.65)',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    maxHeight: '80%',
    width: '100%',
    maxWidth: 520,
  },
  childOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    padding: 24,
    backgroundColor: 'rgba(14, 27, 47, 0.45)',
  },
  childPanel: { maxHeight: '75%' },
  modalHeader: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalHeading: { flex: 1, fontWeight: '700', fontSize: 17, color: colors.navy },
  modalBody: { padding: 16, paddingBottom: 24, gap: 14 },
  detailLine: { gap: 5, paddingBottom: 10 },
  sectionSubtitle: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  evidence: {
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    paddingTop: 10,
  },
  warning: { color: colors.amber, lineHeight: 19 },
});

function checkState(status: MoveInRoomCheck['status'] | undefined) {
  if (status === 'Passed')
    return { label: 'Đạt', icon: 'check-circle-outline', color: colors.green };
  if (status === 'Issue')
    return { label: 'Có vấn đề', icon: 'alert-circle-outline', color: colors.amber };
  if (status === 'NotApplicable')
    return { label: 'Không áp dụng', icon: 'minus-circle-outline', color: colors.muted };
  return { label: 'Chưa kiểm tra', icon: 'clock-outline', color: colors.muted };
}

function compactRow({
  label,
  detail,
  status,
  icon,
  onPress,
}: {
  label: string;
  detail: string;
  status?: 'success' | 'issue';
  icon?: string;
  onPress: () => void;
}) {
  return (
    <TouchableRipple accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <View style={styles.listRow}>
        <Icon
          source={icon ?? (status === 'issue' ? 'alert-circle-outline' : 'clipboard-text-outline')}
          size={21}
          color={status === 'issue' ? colors.amber : colors.blue}
        />
        <View style={styles.listText}>
          <Text style={styles.rowLabel}>{label}</Text>
          <Text style={styles.rowDetail}>{detail}</Text>
        </View>
        <Icon source="chevron-right" size={22} color={colors.muted} />
      </View>
    </TouchableRipple>
  );
}

function EvidenceGallery({
  api,
  contractId,
  ids,
  label,
  readingId,
}: {
  api: ContractClient;
  contractId: string;
  ids?: string[];
  label: string;
  readingId?: string;
}) {
  const [selectedPhoto, setSelectedPhoto] = useState(0);
  const photoIds = ids ?? [];
  const visibleIndex = Math.min(selectedPhoto, Math.max(0, photoIds.length - 1));
  const activeId = photoIds[visibleIndex];
  if (!readingId && !ids?.length) return null;
  return (
    <View style={styles.evidence}>
      <Text style={styles.groupTitle}>{label}</Text>
      {readingId && (
        <ContractEvidence
          api={api}
          contractId={contractId}
          readingId={readingId}
          thumbnail
          thumbnailHeight={240}
          label={label}
        />
      )}
      {!!activeId && (
        <View key={activeId} style={{ gap: 6 }}>
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Button
              compact
              disabled={visibleIndex === 0}
              onPress={() => setSelectedPhoto((index) => Math.max(0, index - 1))}
            >
              Ảnh trước
            </Button>
            <Text style={styles.subtle}>
              Ảnh {visibleIndex + 1}/{photoIds.length}
            </Text>
            <Button
              compact
              disabled={visibleIndex >= photoIds.length - 1}
              onPress={() => setSelectedPhoto((index) => Math.min(photoIds.length - 1, index + 1))}
            >
              Ảnh sau
            </Button>
          </View>
          <ContractEvidence
            api={api}
            contractId={contractId}
            evidenceId={activeId}
            draftHandoverEvidence
            thumbnail
            thumbnailHeight={240}
            label={`${label} ${visibleIndex + 1}`}
          />
        </View>
      )}
    </View>
  );
}

/** Only a short overview belongs in the Tenant page; proofs are fetched and
 * rendered after opening an item, never expanded into the main scroll area. */
export function TenantMoveInHandoverSummary({
  api,
  contractId,
  draft,
  documents,
  documentsError,
  documentsLoading = false,
}: {
  api: ContractClient;
  contractId: string;
  draft: MoveInDraft;
  documents: PreviewDocument[];
  documentsError?: string;
  documentsLoading?: boolean;
}) {
  const [detail, setDetail] = useState<Detail>(null);
  const roomIssues = (draft.roomChecks ?? []).filter((item) => item.status === 'Issue');
  const roomPassed = (draft.roomChecks ?? []).filter((item) => item.status === 'Passed').length;
  const keys = (draft.accessItems ?? []).find((item) => item.type === 'RoomKey');
  const inspections = draft.inspectedAssets ?? [];
  const quantityText = (item: HandoverAsset) => {
    if (item.observedQuantity != null) return handoverAssetSummary(item);
    const inspected = inspections.find((entry) => entry.id === item.id);
    if (inspected)
      return `${item.name}: kiểm kê ${inspected.actualQuantity} / dự kiến ${inspected.expectedQuantity} ${item.unit ?? 'đơn vị'} · ${inspected.condition === 'Good' ? 'Tốt' : inspected.condition}`;
    if (item.configuredQuantity != null)
      return `${item.name}: dự kiến ${item.configuredQuantity} ${item.unit ?? 'đơn vị'} · Chưa ghi nhận số lượng thực tế`;
    return `${item.name}: Chưa có số liệu kiểm kê`;
  };

  const entry = (label: string, text: string, section: Section, icon: string, problem = false) =>
    compactRow({
      label,
      detail: text,
      icon,
      status: problem ? 'issue' : 'success',
      onPress: () => setDetail({ section }),
    });
  const goBack = () => setDetail((current) => (current ? { section: current.section } : null));

  function renderPanel(detail: NonNullable<Detail>, covered = false, child = false) {
    const check =
      detail?.section === 'room' && detail.item && detail.item !== 'overall'
        ? (draft.roomChecks ?? []).find((item) => item.code === detail.item)
        : null;
    const asset =
      detail?.section === 'assets' && detail.item
        ? draft.assets.find((item) => item.id === detail.item)
        : null;
    const roomName = roomHandoverChecks.find((item) => item.code === detail?.item)?.label;
    const title =
      detail?.section === 'room'
        ? (roomName ?? (detail.item === 'overall' ? 'Hiện trạng chung' : 'Hiện trạng phòng'))
        : detail?.section === 'meters'
          ? detail.item === 'electricity'
            ? 'Chỉ số điện ban đầu'
            : detail.item === 'water'
              ? 'Chỉ số nước ban đầu'
              : 'Điện và nước'
          : detail?.section === 'assets'
            ? (asset?.name ?? 'Tài sản bàn giao')
            : detail?.section === 'keys'
              ? 'Chìa khóa và quyền ra vào'
              : detail?.section === 'contract'
                ? 'Thông tin hợp đồng'
                : 'Tài liệu và xác nhận';
    return (
      <View
        style={[styles.modalOverlay, child && styles.childOverlay]}
        pointerEvents={covered ? 'none' : 'auto'}
        accessibilityElementsHidden={covered}
        importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
      >
        <View
          testID={child ? 'handover-detail-panel' : 'handover-list-panel'}
          style={[styles.modalSheet, child && styles.childPanel]}
        >
          <View style={styles.modalHeader}>
            {!!detail?.item && (
              <Button compact onPress={goBack} accessibilityLabel="Quay lại danh sách">
                Quay lại
              </Button>
            )}
            <Text numberOfLines={2} style={styles.modalHeading}>
              {title}
            </Text>
            <Button compact onPress={child ? goBack : () => setDetail(null)}>
              Đóng
            </Button>
          </View>
          <ScrollView
            style={{ flexShrink: 1 }}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.modalBody}
          >
            {detail?.section === 'room' && !detail.item && (
              <>
                {compactRow({
                  label: 'Hiện trạng chung',
                  detail: `${draft.roomCondition ? 'Đã ghi nhận' : 'Chưa ghi nhận'} · ${draft.evidenceIds.length} ảnh`,
                  icon: 'home-outline',
                  onPress: () => setDetail({ section: 'room', item: 'overall' }),
                })}
                <View style={styles.separator} />
                {roomHandoverChecks.map(({ code, label }) => {
                  const observed = (draft.roomChecks ?? []).find((item) => item.code === code);
                  const state = checkState(observed?.status);
                  return (
                    <View key={code}>
                      {compactRow({
                        label,
                        detail: `${state.label}${observed?.status !== 'Passed' && observed?.notes ? ` · ${observed.notes}` : ''}${observed?.evidenceIds?.length ? ` · ${observed.evidenceIds.length} ảnh` : ''}`,
                        status: observed?.status === 'Issue' ? 'issue' : 'success',
                        icon: state.icon,
                        onPress: () => setDetail({ section: 'room', item: code }),
                      })}
                      <View style={styles.separator} />
                    </View>
                  );
                })}
                {(draft.outstandingIssues ?? []).map((issue, index) => (
                  <Text key={`${issue.code}-${index}`} style={styles.warning}>
                    {issue.description}
                  </Text>
                ))}
              </>
            )}
            {detail?.section === 'room' && detail.item === 'overall' && (
              <>
                <Text style={styles.sectionSubtitle}>
                  {draft.roomCondition || 'Không có ghi chú'}
                </Text>
                <EvidenceGallery
                  api={api}
                  contractId={contractId}
                  ids={draft.evidenceIds}
                  label="Ảnh hiện trạng chung"
                />
              </>
            )}
            {detail?.section === 'room' && check && (
              <>
                <Pill
                  tone={
                    check.status === 'Passed'
                      ? 'green'
                      : check.status === 'Issue'
                        ? 'red'
                        : 'neutral'
                  }
                >
                  {checkState(check.status).label}
                </Pill>
                {!!check.notes?.trim() && <Text>{check.notes}</Text>}
                <EvidenceGallery
                  api={api}
                  contractId={contractId}
                  ids={check.evidenceIds}
                  label="Ảnh kiểm tra"
                />
                {!check.evidenceIds?.length && (
                  <Text style={styles.subtle}>Không có ảnh đính kèm cho mục này.</Text>
                )}
              </>
            )}
            {detail?.section === 'room' && detail.item && detail.item !== 'overall' && !check && (
              <Text>Chưa kiểm tra mục này.</Text>
            )}
            {detail?.section === 'meters' && !detail.item && (
              <>
                {compactRow({
                  label: 'Điện',
                  detail: draft.electricity
                    ? `${displayMeterReading(draft.electricity.value)} kWh`
                    : 'Chưa xác nhận',
                  icon: 'lightning-bolt-outline',
                  onPress: () => setDetail({ section: 'meters', item: 'electricity' }),
                })}
                <View style={styles.separator} />
                {compactRow({
                  label: 'Nước',
                  detail: draft.water
                    ? `${displayMeterReading(draft.water.value)} m³`
                    : 'Chưa xác nhận',
                  icon: 'water-outline',
                  onPress: () => setDetail({ section: 'meters', item: 'water' }),
                })}
              </>
            )}
            {detail?.section === 'meters' && detail.item && (
              <>
                {detail.item === 'electricity' && (
                  <View style={styles.detailLine}>
                    <Text style={styles.rowLabel}>
                      Điện:{' '}
                      {draft.electricity
                        ? `${displayMeterReading(draft.electricity.value)} kWh`
                        : 'Chưa xác nhận'}
                    </Text>
                    <EvidenceGallery
                      api={api}
                      contractId={contractId}
                      readingId={draft.electricity?.id}
                      label="Ảnh công tơ điện"
                    />
                  </View>
                )}
                {detail.item === 'water' && (
                  <View style={styles.detailLine}>
                    <Text style={styles.rowLabel}>
                      Nước:{' '}
                      {draft.water
                        ? `${displayMeterReading(draft.water.value)} m³`
                        : 'Chưa xác nhận'}
                    </Text>
                    <EvidenceGallery
                      api={api}
                      contractId={contractId}
                      readingId={draft.water?.id}
                      label="Ảnh công tơ nước"
                    />
                  </View>
                )}
              </>
            )}
            {detail?.section === 'assets' && !asset && (
              <>
                {draft.assets.map((item: HandoverAsset) => (
                  <View key={item.id}>
                    {compactRow({
                      label: item.name,
                      detail: quantityText(item),
                      icon: 'package-variant-closed',
                      onPress: () => setDetail({ section: 'assets', item: item.id }),
                    })}
                  </View>
                ))}
                {!draft.assets.length && (
                  <Text>
                    {draft.noAssetsConfirmed
                      ? 'Phòng được xác nhận không có tài sản bàn giao.'
                      : 'Chưa có kết quả kiểm kê tài sản.'}
                  </Text>
                )}
              </>
            )}
            {detail?.section === 'assets' && asset && (
              <>
                <Text style={styles.sectionSubtitle}>{quantityText(asset)}</Text>
                {!!asset.notes?.trim() && <Text>{asset.notes}</Text>}
                <EvidenceGallery
                  api={api}
                  contractId={contractId}
                  ids={asset.evidenceIds}
                  label="Ảnh tài sản"
                />
              </>
            )}
            {detail?.section === 'keys' && (
              <>
                <Text style={styles.rowLabel}>
                  {keys ? `${keys.quantity} chìa khóa phòng` : 'Chưa kiểm đếm chìa khóa'}
                </Text>
                {!!keys?.notes?.trim() && <Text>{keys.notes}</Text>}
                <EvidenceGallery
                  api={api}
                  contractId={contractId}
                  ids={draft.keyEvidenceIds}
                  label="Ảnh chìa khóa"
                />
              </>
            )}
            {detail?.section === 'contract' && (
              <>
                <Text style={styles.rowLabel}>
                  Phòng {draft.roomNumber} · {draft.locationName}
                </Text>
                {!!draft.locationAddress && (
                  <Text style={styles.sectionSubtitle}>{draft.locationAddress}</Text>
                )}
                <Text>
                  Thời hạn: {displayContractDate(draft.startDate)} –{' '}
                  {displayContractDate(draft.endDate)}
                </Text>
                <Text>Giá thuê: {formatContractMoney(String(draft.monthlyRent))} / tháng</Text>
                <Text>Tiền cọc: {formatContractMoney(String(draft.requiredDeposit))}</Text>
                {!!draft.terms && <Text>Điều khoản: {draft.terms}</Text>}
                {!!draft.notes && <Text>Ghi chú chung: {draft.notes}</Text>}
              </>
            )}
            {detail?.section === 'documents' && (
              <>
                {documentsLoading && (
                  <Text style={styles.sectionSubtitle}>Đang tải biên bản PDF đã ký…</Text>
                )}
                {!!draft.ownerReadyAt && (
                  <Text style={styles.sectionSubtitle}>
                    Chủ trọ xác nhận: {formatInstant(draft.ownerReadyAt)}
                  </Text>
                )}
                {!!draft.tenantConfirmedAt && (
                  <Text style={styles.sectionSubtitle}>
                    Khách thuê xác nhận: {formatInstant(draft.tenantConfirmedAt)}
                  </Text>
                )}
                {draft.status === 'Ready' && (
                  <ContractEvidence
                    api={api}
                    contractId={contractId}
                    draftHandoverPdf
                    label="Xem PDF chủ trọ đã ký"
                  />
                )}
                {documents.map((document) => (
                  <ContractEvidence
                    key={document.id}
                    api={api}
                    contractId={contractId}
                    handoverDocumentId={document.id}
                    label="Mở biên bản cuối cùng"
                  />
                ))}
                {draft.status === 'Confirmed' && !!documentsError && (
                  <Text accessibilityRole="alert" style={styles.warning}>
                    Không tải được PDF: {documentsError}
                  </Text>
                )}
                {draft.status === 'Confirmed' &&
                  !documentsLoading &&
                  !documents.length &&
                  !documentsError && (
                    <Text style={styles.subtle}>
                      Biên bản đã ký chưa có PDF cuối cùng. Hãy tải lại hoặc liên hệ chủ trọ.
                    </Text>
                  )}
                {draft.requests.map((request) => (
                  <View key={request.id} style={styles.detailLine}>
                    <Text style={styles.rowLabel}>Yêu cầu chỉnh sửa · {request.status}</Text>
                    <Text>{request.reason}</Text>
                    {!!request.decisionReason && (
                      <Text>Phản hồi chủ trọ: {request.decisionReason}</Text>
                    )}
                  </View>
                ))}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.intro}>
        <View style={styles.summary}>
          <Pill
            tone={
              draft.status === 'Confirmed' ? 'green' : draft.status === 'Ready' ? 'blue' : 'amber'
            }
          >
            {statusLabels[draft.status]}
          </Pill>
        </View>
        <Text style={styles.heading}>Phòng {draft.roomNumber}</Text>
        <Text style={styles.summaryText}>{draft.locationName}</Text>
        <Text style={styles.subtle}>
          Ngày thuê: {displayContractDate(draft.startDate)} – {displayContractDate(draft.endDate)}
        </Text>
      </View>

      <View>
        <Text style={styles.groupTitle}>Nội dung bàn giao</Text>
        <View style={styles.group}>
          {entry(
            'Hiện trạng phòng',
            `${roomPassed}/7 mục đạt${roomIssues.length ? ` · ${roomIssues.length} mục có vấn đề` : ''}`,
            'room',
            'home-outline',
            roomIssues.length > 0,
          )}
          <View style={styles.separator} />
          {entry(
            'Điện và nước',
            `Điện: ${displayMeterReading(draft.electricity?.value)} kWh · Nước: ${displayMeterReading(draft.water?.value)} m³`,
            'meters',
            'lightning-bolt-outline',
          )}
          <View style={styles.separator} />
          {entry(
            'Tài sản',
            draft.noAssetsConfirmed
              ? 'Phòng được xác nhận không có tài sản'
              : `${draft.assets.length} nhóm tài sản${inspections.length ? ` · ${inspections.reduce((sum, item) => sum + item.actualQuantity, 0)} tài sản đã kiểm kê` : ''}`,
            'assets',
            'bed-outline',
          )}
          <View style={styles.separator} />
          {entry(
            'Chìa khóa',
            keys ? `${keys.quantity} chiếc đã bàn giao` : 'Chưa kiểm đếm',
            'keys',
            'key-outline',
          )}
        </View>
      </View>

      <View>
        <Text style={styles.groupTitle}>Tài liệu và thông tin</Text>
        <View style={styles.group}>
          {entry(
            'Biên bản và chữ ký',
            draft.status === 'Ready'
              ? 'Xem PDF chủ trọ đã ký'
              : draft.status === 'Confirmed'
                ? 'Xem biên bản đã hoàn tất'
                : 'Thông tin xác nhận',
            'documents',
            'file-document-outline',
          )}
          <View style={styles.separator} />
          {entry(
            'Thông tin hợp đồng',
            'Giá thuê, tiền cọc, điều khoản',
            'contract',
            'information-outline',
          )}
        </View>
      </View>

      {draft.missing.length > 0 && (
        <View style={{ gap: 5 }}>
          <Text style={[styles.groupTitle, styles.warning]}>Cần hoàn tất trước khi ký</Text>
          {draft.missing.map((item, index) => (
            <Text key={`${item}-${index}`} style={styles.sectionSubtitle}>
              • {moveInMissingMessage(item)}
            </Text>
          ))}
        </View>
      )}

      <Modal
        visible={!!detail}
        transparent
        animationType="fade"
        onRequestClose={detail?.item ? goBack : () => setDetail(null)}
      >
        <View style={{ flex: 1 }}>
          {detail && renderPanel({ section: detail.section }, !!detail.item)}
          {detail?.item && renderPanel(detail, false, true)}
        </View>
      </Modal>
    </View>
  );
}
