import React, { useState } from 'react';
import { Checkbox, SegmentedButtons, Text } from 'react-native-paper';
import type { HandoverAsset } from '../../../../../packages/client-core/src/contracts';
import { quantityFields } from '../../../../../packages/client-core/src/handoverForm';
import { Input } from '../../components/WorkflowControls';
import { Action } from '../../components/WorkspaceKit';

export function HandoverAssetFields({
  asset,
  values,
  set,
  evidenceIds,
  disabled = false,
  quantities = true,
  showCheckWithoutQuantities = false,
  compact = false,
  embedded = false,
  hideEvidenceChoices = false,
}: {
  asset: HandoverAsset;
  values: Record<string, string>;
  set: (key: string, value: string) => void;
  evidenceIds: string[];
  disabled?: boolean;
  quantities?: boolean;
  showCheckWithoutQuantities?: boolean;
  compact?: boolean;
  embedded?: boolean;
  hideEvidenceChoices?: boolean;
}) {
  const a = asset;
  const [expanded, setExpanded] = useState(embedded);
  const [adjustDetails, setAdjustDetails] = useState(false);
  // Keep the UI choice in the parent form, so Wizard navigation does not
  // discard the selected inspection mode while unsaved quantities remain.
  const savedMode = values[`${a.id}.quantityMode`];
  const quantityMode: 'match' | 'difference' | '' =
    savedMode === 'match' || savedMode === 'difference'
      ? savedMode
      : a.checked && a.observedQuantity != null && a.configuredQuantity != null
        ? a.observedQuantity === a.configuredQuantity
          ? 'match'
          : 'difference'
        : '';
  const expected = a.configuredQuantity ?? a.handedOverQuantity;
  const observed = values[`${a.id}.observedQuantity`];
  const condition = values[`asset-${a.id}`] ?? '';
  function setSimpleQuantities(mode: 'match' | 'difference', nextCondition = condition) {
    if (mode === 'difference' && quantityMode === 'match') {
      // The previously autofilled "exact count" is no longer a verified
      // observation. Require Staff to enter the differing counts explicitly.
      quantityFields.forEach(([key]) => set(`${a.id}.${key}`, ''));
      set(`${a.id}.checked`, 'false');
    }
    set(`${a.id}.quantityMode`, mode);
    if (mode !== 'match' || !quantities || expected == null) return;
    const count = String(expected);
    set(`${a.id}.observedQuantity`, count);
    set(`${a.id}.handedOverQuantity`, count);
    const category =
      nextCondition === 'Hao mòn'
        ? 'wornQuantity'
        : nextCondition === 'Hỏng'
          ? 'damagedQuantity'
          : 'goodQuantity';
    (['goodQuantity', 'wornQuantity', 'damagedQuantity'] as const).forEach((key) =>
      set(`${a.id}.${key}`, key === category ? count : '0'),
    );
    // Individual physical quantities still need review; group totals never
    // imply that Staff confirmed every physical serial-numbered item.
  }
  return (
    <>
      <Text variant="titleSmall">
        {a.name} · {a.unit ?? 'đơn vị'} · Yêu cầu / baseline:{' '}
        {a.configuredQuantity ?? a.handedOverQuantity ?? 'chưa rõ'}
      </Text>
      <Text>
        Kiểm kê: {a.inventoryCondition || 'Chưa có'} ·{' '}
        {a.ownerChecked ? 'Owner đã kiểm tra' : 'Chưa được Owner kiểm tra đủ'}
      </Text>
      {!embedded && (
        <Action secondary disabled={disabled} onPress={() => setExpanded(!expanded)}>
          {expanded
            ? `Thu gọn ${a.name}`
            : `${values[`${a.id}.checked`] === 'true' ? 'Đã kiểm tra' : 'Kiểm tra'} ${a.name}`}
        </Action>
      )}
      {expanded && (
        <>
          {compact ? (
            <>
              <Text>Số lượng thực tế</Text>
              <SegmentedButtons
                value={quantityMode}
                onValueChange={(value) => setSimpleQuantities(value as 'match' | 'difference')}
                density="small"
                buttons={[
                  {
                    value: 'match',
                    label: 'Đúng số lượng',
                    disabled: disabled || expected == null,
                  },
                  { value: 'difference', label: 'Có chênh lệch', disabled },
                ]}
              />
              <Text>Tình trạng quan sát</Text>
              <SegmentedButtons
                value={condition}
                onValueChange={(value) => {
                  set(`asset-${a.id}`, value);
                  if (quantityMode === 'match') setSimpleQuantities('match', value);
                }}
                density="small"
                buttons={[
                  { value: 'Tốt', label: 'Tốt', disabled },
                  { value: 'Hao mòn', label: 'Hao mòn', disabled },
                  { value: 'Hỏng', label: 'Hỏng', disabled },
                ]}
              />
              {quantityMode === 'match' && (
                <Text>
                  Đã ghi nhận {expected} {a.unit ?? 'đơn vị'} theo tình trạng đã chọn.
                </Text>
              )}
              {quantities && quantityMode !== 'difference' && (
                <Action
                  secondary
                  disabled={disabled}
                  onPress={() => setAdjustDetails((value) => !value)}
                >
                  {adjustDetails ? 'Ẩn số lượng chi tiết' : 'Điều chỉnh số lượng chi tiết'}
                </Action>
              )}
            </>
          ) : (
            <Input
              label={`${a.name} · Tình trạng thực tế`}
              value={values[`asset-${a.id}`] ?? ''}
              onChange={(v) => set(`asset-${a.id}`, v)}
              disabled={disabled}
              multiline
            />
          )}
          {quantities && (
            <>
              {(!compact || quantityMode === 'difference' || adjustDetails) &&
                quantityFields.map(([key, label]) => (
                  <Input
                    key={key}
                    label={`${a.name} · ${label}`}
                    value={values[`${a.id}.${key}`] ?? ''}
                    onChange={(v) => set(`${a.id}.${key}`, v)}
                    disabled={disabled}
                    numeric
                  />
                ))}
              {(!compact || quantityMode === 'difference' || adjustDetails) && (
                <Text>
                  Thiếu:{' '}
                  {expected != null && observed && /^\d+$/.test(observed)
                    ? Math.max(0, expected - Number(observed))
                    : 'chưa đủ dữ liệu so sánh'}
                  ; hư hỏng được ghi riêng. Không tự quy trách nhiệm bồi thường.
                </Text>
              )}
              {(a.physicalAssets?.length ?? 0) > 1 &&
                a.physicalAssets!.map((p, index) => (
                  <React.Fragment key={p.id}>
                    <Input
                      label={`${a.name} · Số lượng tài sản ${index + 1}`}
                      value={values[`${p.id}.physicalQuantity`] ?? ''}
                      onChange={(v) => set(`${p.id}.physicalQuantity`, v)}
                      disabled={disabled}
                      numeric
                    />
                    <Input
                      label={`${a.name} · Hiện trạng tài sản ${index + 1}`}
                      value={values[`${p.id}.physicalCondition`] ?? ''}
                      onChange={(v) => set(`${p.id}.physicalCondition`, v)}
                      disabled={disabled}
                    />
                    <Input
                      label={`${a.name} · Số lượng giao tài sản ${index + 1} (nếu khác thực tế)`}
                      value={values[`${p.id}.physicalHandedOverQuantity`] ?? ''}
                      onChange={(v) => set(`${p.id}.physicalHandedOverQuantity`, v)}
                      disabled={disabled}
                      numeric
                    />
                  </React.Fragment>
                ))}
              <Input
                label={`${a.name} · Ghi chú / lý do không bàn giao`}
                value={values[`${a.id}.notes`] ?? ''}
                onChange={(v) => set(`${a.id}.notes`, v)}
                disabled={disabled}
                multiline
              />
              <Text>Ảnh riêng cho {a.name} (bắt buộc khi thiếu, hỏng hoặc sai lệch):</Text>
              {!hideEvidenceChoices &&
                evidenceIds.map((id, index) => (
                  <Checkbox.Item
                    key={id}
                    label={`${a.name} · Ảnh ${index + 1}`}
                    status={values[`${a.id}.evidence.${id}`] === 'true' ? 'checked' : 'unchecked'}
                    onPress={() =>
                      set(
                        `${a.id}.evidence.${id}`,
                        values[`${a.id}.evidence.${id}`] === 'true' ? 'false' : 'true',
                      )
                    }
                    disabled={disabled}
                  />
                ))}
            </>
          )}
          {(quantities || showCheckWithoutQuantities) && (
            <Checkbox.Item
              label={`Đã kiểm tra ${a.name}`}
              status={values[`${a.id}.checked`] === 'true' ? 'checked' : 'unchecked'}
              onPress={() =>
                set(`${a.id}.checked`, values[`${a.id}.checked`] === 'true' ? 'false' : 'true')
              }
              disabled={disabled}
            />
          )}
        </>
      )}
    </>
  );
}
