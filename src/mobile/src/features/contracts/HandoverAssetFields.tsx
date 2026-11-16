import React, { useState } from 'react';
import { Checkbox, Text } from 'react-native-paper';
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
}: {
  asset: HandoverAsset;
  values: Record<string, string>;
  set: (key: string, value: string) => void;
  evidenceIds: string[];
  disabled?: boolean;
  quantities?: boolean;
}) {
  const a = asset;
  const [expanded, setExpanded] = useState(false);
  const expected = a.configuredQuantity ?? a.handedOverQuantity;
  const observed = values[`${a.id}.observedQuantity`];
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
      <Action secondary disabled={disabled} onPress={() => setExpanded(!expanded)}>
        {expanded
          ? `Thu gọn ${a.name}`
          : `${values[`${a.id}.checked`] === 'true' ? 'Đã kiểm tra' : 'Kiểm tra'} ${a.name}`}
      </Action>
      {expanded && (
        <>
          <Input
            label={`${a.name} · Tình trạng thực tế`}
            value={values[`asset-${a.id}`] ?? ''}
            onChange={(v) => set(`asset-${a.id}`, v)}
            disabled={disabled}
            multiline
          />
          {quantities && (
            <>
              {quantityFields.map(([key, label]) => (
                <Input
                  key={key}
                  label={`${a.name} · ${label}`}
                  value={values[`${a.id}.${key}`] ?? ''}
                  onChange={(v) => set(`${a.id}.${key}`, v)}
                  disabled={disabled}
                  numeric
                />
              ))}
              <Text>
                Thiếu:{' '}
                {expected != null && observed && /^\d+$/.test(observed)
                  ? Math.max(0, expected - Number(observed))
                  : 'chưa đủ dữ liệu so sánh'}
                ; hư hỏng được ghi riêng. Không tự quy trách nhiệm bồi thường.
              </Text>
              {(a.physicalAssets?.length ?? 0) > 1 &&
                a.physicalAssets!.map((p) => (
                  <React.Fragment key={p.id}>
                    <Input
                      label={`${a.name} · Số lượng tài sản ${p.id}`}
                      value={values[`${p.id}.physicalQuantity`] ?? ''}
                      onChange={(v) => set(`${p.id}.physicalQuantity`, v)}
                      disabled={disabled}
                      numeric
                    />
                    <Input
                      label={`${a.name} · Hiện trạng tài sản ${p.id}`}
                      value={values[`${p.id}.physicalCondition`] ?? ''}
                      onChange={(v) => set(`${p.id}.physicalCondition`, v)}
                      disabled={disabled}
                    />
                    <Input
                      label={`${a.name} · Số lượng giao tài sản ${p.id} (khi giao ít hơn thực tế)`}
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
              {evidenceIds.map((id, index) => (
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
              <Checkbox.Item
                label={`Đã kiểm tra ${a.name}`}
                status={values[`${a.id}.checked`] === 'true' ? 'checked' : 'unchecked'}
                onPress={() =>
                  set(`${a.id}.checked`, values[`${a.id}.checked`] === 'true' ? 'false' : 'true')
                }
                disabled={disabled}
              />
            </>
          )}
        </>
      )}
    </>
  );
}
