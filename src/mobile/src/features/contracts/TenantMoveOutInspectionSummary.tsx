import React, { useState } from 'react';
import { Modal, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Button, Icon, Text, TouchableRipple } from 'react-native-paper';
import {
  type ContractClient,
  type FinalInspection,
  type HandoverAsset,
} from '../../../../../packages/client-core/src/contracts';
import { formatInstant } from '../../../../../packages/client-core/src/localization';
import { roomHandoverChecks } from '../../services/moveInHandover';
import { colors } from '../../theme/theme';
import { Pill } from '../../components/WorkspaceKit';
import { ContractEvidence } from './ContractEvidence';

type Section = 'room' | 'meters' | 'assets' | 'keys';
type Detail = { section: Section; item?: string } | null;

const styles = StyleSheet.create({
  root: { gap: 14, minWidth: 0 },
  intro: { gap: 7 },
  status: { flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  heading: { fontSize: 17, fontWeight: '700', color: colors.navy },
  subtle: { fontSize: 12, lineHeight: 18, color: colors.muted },
  groupTitle: { fontSize: 13, fontWeight: '700', color: colors.navy, marginBottom: 8 },
  group: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  row: {
    minHeight: 57,
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 11,
    gap: 11,
    alignItems: 'center',
  },
  rowBody: { flex: 1, minWidth: 0, gap: 3 },
  rowLabel: { fontSize: 14, fontWeight: '600', color: colors.navy },
  rowDetail: { fontSize: 12, lineHeight: 17, color: colors.muted },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginHorizontal: 12,
  },
  overlay: {
    flex: 1,
    padding: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(14, 27, 47, 0.65)',
  },
  modal: {
    width: '100%',
    maxWidth: 520,
    maxHeight: '88%',
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#fff',
  },
  phoneOverlay: { paddingHorizontal: 0, paddingBottom: 0, justifyContent: 'flex-end' },
  phoneModal: { maxHeight: '92%', borderBottomLeftRadius: 0, borderBottomRightRadius: 0 },
  modalHeader: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  modalTitle: { flex: 1, minWidth: 0, fontSize: 16, fontWeight: '700', color: colors.navy },
  modalContent: { padding: 15, paddingBottom: 28, gap: 12 },
  detailBlock: { gap: 6, paddingVertical: 5 },
  detailLabel: { fontSize: 13, fontWeight: '700', color: colors.navy },
  detailText: { fontSize: 13, lineHeight: 19, color: colors.navy },
  warning: { fontSize: 13, color: colors.amber, lineHeight: 19 },
});

const statusText = (value?: string | null) => {
  if (!value?.trim()) return 'Chưa có dữ liệu';
  if (['Passed', 'Good', 'Tốt', 'Đạt'].includes(value)) return 'Tốt';
  if (['Issue', 'Có vấn đề', 'Damaged'].includes(value)) return 'Có vấn đề';
  if (value === 'NotApplicable') return 'Không áp dụng';
  return value;
};

function meterNumber(value?: string | null): string {
  if (value == null || value === '') return 'Chưa có chỉ số';
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric).toLocaleString('vi-VN') : value;
}

function EvidenceGallery({
  api,
  contractId,
  ids,
  label,
}: {
  api: ContractClient;
  contractId: string;
  ids?: string[] | null;
  label: string;
}) {
  const [selected, setSelected] = useState(0);
  if (!ids?.length) return null;
  const index = Math.min(selected, ids.length - 1);
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.detailLabel}>{label}</Text>
      {ids.length > 1 && (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Button
            compact
            disabled={index === 0}
            onPress={() => setSelected((old) => Math.max(0, old - 1))}
          >
            Ảnh trước
          </Button>
          <Text style={styles.subtle}>
            {index + 1}/{ids.length}
          </Text>
          <Button
            compact
            disabled={index === ids.length - 1}
            onPress={() => setSelected((old) => Math.min(ids.length - 1, old + 1))}
          >
            Ảnh sau
          </Button>
        </View>
      )}
      <ContractEvidence
        key={ids[index]}
        api={api}
        contractId={contractId}
        evidenceId={ids[index]}
        thumbnail
        thumbnailHeight={205}
        label={label}
      />
    </View>
  );
}

function DetailRow({
  label,
  detail,
  icon,
  warning = false,
  onPress,
}: {
  label: string;
  detail: string;
  icon: string;
  warning?: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableRipple accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>
      <View style={styles.row}>
        <Icon source={icon} size={21} color={warning ? colors.amber : colors.blue} />
        <View style={styles.rowBody}>
          <Text style={styles.rowLabel}>{label}</Text>
          <Text style={styles.rowDetail}>{detail}</Text>
        </View>
        <Icon source="chevron-right" size={21} color={colors.muted} />
      </View>
    </TouchableRipple>
  );
}

function assetIssue(asset: HandoverAsset) {
  return statusText(asset.observedCondition) === 'Có vấn đề';
}

export function TenantMoveOutInspectionSummary({
  api,
  contractId,
  inspection,
}: {
  api: ContractClient;
  contractId: string;
  inspection: FinalInspection;
}) {
  const [detail, setDetail] = useState<Detail>(null);
  const { width } = useWindowDimensions();
  const compactPhone = width < 540;
  const observed = inspection.observed;
  const checks = observed.roomChecks ?? [];
  const totalChecks = roomHandoverChecks.length;
  const checkedCount = checks.filter(
    (item) => item.status === 'Passed' || item.status === 'Issue',
  ).length;
  const roomIssues = checks.filter((item) => item.status === 'Issue').length;
  const assetIssues = observed.assets.filter(assetIssue).length;
  const newKeys = observed.accessItems?.find((item) => item.type === 'RoomKey')?.quantity;
  const room =
    detail?.section === 'room' && detail.item
      ? checks.find((item) => item.code === detail.item)
      : undefined;
  const asset =
    detail?.section === 'assets' && detail.item
      ? observed.assets.find((item) => item.id === detail.item)
      : undefined;
  const roomTitle = roomHandoverChecks.find((item) => item.code === detail?.item)?.label;
  const title =
    detail?.section === 'room'
      ? (roomTitle ?? 'Hiện trạng phòng')
      : detail?.section === 'meters'
        ? 'Chỉ số điện và nước chốt'
        : detail?.section === 'assets'
          ? (asset?.name ?? 'Tài sản trả phòng')
          : 'Chìa khóa';
  const goBack = () =>
    setDetail((current) => (current?.item ? { section: current.section } : null));

  return (
    <View style={styles.root}>
      <View style={styles.intro}>
        <View style={styles.status}>
          <Pill tone={roomIssues || assetIssues ? 'amber' : 'green'}>Đã kiểm tra</Pill>
          <Text style={styles.subtle}>Kiểm kê lần {inspection.version}</Text>
        </View>
        <Text style={styles.heading}>Kết quả kiểm tra trả phòng</Text>
        <Text style={styles.subtle}>
          Staff đã ghi nhận ngày {formatInstant(inspection.inspectedAt)}
        </Text>
      </View>

      <View>
        <Text style={styles.groupTitle}>Nội dung trả phòng</Text>
        <View style={styles.group}>
          <DetailRow
            label="Hiện trạng phòng"
            detail={`${checkedCount}/${totalChecks} mục đã kiểm tra${roomIssues ? ` · ${roomIssues} mục có vấn đề` : ''}`}
            icon="home-outline"
            warning={roomIssues > 0}
            onPress={() => setDetail({ section: 'room' })}
          />
          <View style={styles.divider} />
          <DetailRow
            label="Điện và nước"
            detail={`Điện: ${meterNumber(observed.electricity?.value)} kWh · Nước: ${meterNumber(observed.water?.value)} m³`}
            icon="lightning-bolt-outline"
            onPress={() => setDetail({ section: 'meters' })}
          />
          <View style={styles.divider} />
          <DetailRow
            label="Tài sản"
            detail={`${observed.assets.length} nhóm tài sản${assetIssues ? ` · ${assetIssues} nhóm có vấn đề` : ''}`}
            icon="bed-outline"
            warning={assetIssues > 0}
            onPress={() => setDetail({ section: 'assets' })}
          />
          <View style={styles.divider} />
          <DetailRow
            label="Chìa khóa"
            detail={newKeys == null ? 'Chưa có số lượng nhận lại' : `${newKeys} chiếc đã nhận lại`}
            icon="key-outline"
            onPress={() => setDetail({ section: 'keys' })}
          />
        </View>
      </View>

      <Modal
        visible={!!detail}
        transparent
        animationType="slide"
        onRequestClose={() => setDetail(null)}
      >
        <View style={[styles.overlay, compactPhone && styles.phoneOverlay]}>
          <View style={[styles.modal, compactPhone && styles.phoneModal]}>
            <View style={styles.modalHeader}>
              {!!detail?.item && (
                <Button compact onPress={goBack} accessibilityLabel="Quay lại danh sách">
                  Quay lại
                </Button>
              )}
              <Text style={styles.modalTitle} numberOfLines={2}>
                {title}
              </Text>
              <Button compact onPress={() => setDetail(null)}>
                Đóng
              </Button>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.modalContent}
            >
              {detail?.section === 'room' && !detail.item && (
                <>
                  {roomHandoverChecks.map(({ code, label }) => {
                    const observedCheck = checks.find((item) => item.code === code);
                    const issue = observedCheck?.status === 'Issue';
                    return (
                      <View key={code}>
                        <DetailRow
                          label={label}
                          detail={
                            observedCheck
                              ? `${statusText(observedCheck.status)}${issue && observedCheck.notes ? ` · ${observedCheck.notes}` : ''}`
                              : 'Chưa có kết quả'
                          }
                          icon={issue ? 'alert-circle-outline' : 'check-circle-outline'}
                          warning={issue}
                          onPress={() => setDetail({ section: 'room', item: code })}
                        />
                        <View style={styles.divider} />
                      </View>
                    );
                  })}
                  <EvidenceGallery
                    api={api}
                    contractId={contractId}
                    ids={observed.evidenceIds}
                    label="Ảnh hiện trạng"
                  />
                </>
              )}
              {detail?.section === 'room' && detail.item && (
                <>
                  <Pill tone={room?.status === 'Issue' ? 'amber' : 'green'}>
                    {statusText(room?.status)}
                  </Pill>
                  {!!room?.notes?.trim() && (
                    <Text style={styles.detailText}>Nội dung: {room.notes}</Text>
                  )}
                  <EvidenceGallery
                    api={api}
                    contractId={contractId}
                    ids={room?.evidenceIds}
                    label="Ảnh hiện trạng"
                  />
                </>
              )}
              {detail?.section === 'meters' && (
                <>
                  {(['electricity', 'water'] as const).map((kind) => {
                    const reading = observed[kind];
                    return (
                      <View key={kind} style={styles.detailBlock}>
                        <Text style={styles.detailLabel}>
                          {kind === 'electricity' ? 'Điện' : 'Nước'}
                        </Text>
                        <Text style={styles.detailText}>
                          {meterNumber(reading?.value)} {kind === 'electricity' ? 'kWh' : 'm³'}
                        </Text>
                        {!!reading?.id && (
                          <ContractEvidence
                            api={api}
                            contractId={contractId}
                            readingId={reading.id}
                            finalMeterReading
                            thumbnail
                            thumbnailHeight={205}
                            label="Ảnh công tơ đã chốt"
                          />
                        )}
                      </View>
                    );
                  })}
                </>
              )}
              {detail?.section === 'assets' && !asset && (
                <>
                  {observed.assets.map((item) => {
                    return (
                      <View key={item.id}>
                        <DetailRow
                          label={item.name}
                          detail={`${item.observedQuantity ?? 'Chưa kiểm kê'} ${item.unit ?? 'chiếc'} · ${statusText(item.observedCondition)}`}
                          icon="package-variant-closed"
                          warning={assetIssue(item)}
                          onPress={() => setDetail({ section: 'assets', item: item.id })}
                        />
                        <View style={styles.divider} />
                      </View>
                    );
                  })}
                  {!observed.assets.length && (
                    <Text style={styles.subtle}>
                      Không có tài sản được ghi nhận trong lần kiểm kê.
                    </Text>
                  )}
                </>
              )}
              {detail?.section === 'assets' && asset && (
                <>
                  <View style={styles.detailBlock}>
                    <Text style={styles.detailLabel}>Số lượng hiện tại</Text>
                    <Text style={styles.detailText}>
                      {asset.observedQuantity ?? 'Chưa kiểm kê'} {asset.unit ?? 'chiếc'}
                    </Text>
                  </View>
                  <Text style={styles.detailText}>
                    Tình trạng: {statusText(asset.observedCondition)}
                  </Text>
                  {!!asset.notes?.trim() && (
                    <Text style={styles.detailText}>Nội dung: {asset.notes}</Text>
                  )}
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
                  <Text style={styles.detailText}>
                    Số chìa khóa hiện tại: {newKeys ?? 'Chưa kiểm đếm'}
                  </Text>
                  <EvidenceGallery
                    api={api}
                    contractId={contractId}
                    ids={observed.keyEvidenceIds}
                    label="Ảnh chìa khóa"
                  />
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
