import React, { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { Platform } from 'react-native';
import { Button, IconButton } from 'react-native-paper';
import { colors } from '../theme/theme';

// Keep the display preference when Staff closes one item and opens another.
// The action itself is always supplied by the current eligible item.
let expandedPreference = true;

export function FloatingDemoPhotoButton({
  disabled,
  onPress,
}: {
  disabled: boolean;
  onPress: () => void;
}) {
  const [expanded, setExpanded] = useState(() => expandedPreference);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const attach = useCallback((node: HTMLSpanElement | null) => {
    if (node) {
      // Stay inside the current native-web Modal's focus trap and stacking
      // context, but outside its clipped/scrolling form. Standalone inventory
      // has no modal and instead floats at the viewport level.
      setHost(node.closest<HTMLElement>('[aria-modal="true"], [role="dialog"]') ?? document.body);
    }
  }, []);

  if (Platform.OS !== 'web') return null;

  function toggle(next: boolean) {
    expandedPreference = next;
    setExpanded(next);
  }

  return (
    <>
      <span ref={attach} hidden />
      {host &&
        createPortal(
          <div
            role="group"
            aria-label="Công cụ ảnh mẫu DEV"
            style={{
              position: host === document.body ? 'fixed' : 'absolute',
              top: '22%',
              right: 8,
              zIndex: 1000,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              borderRadius: 24,
              backgroundColor: colors.primary,
              boxShadow: '0 3px 12px rgba(20, 33, 61, 0.24)',
            }}
          >
            {expanded ? (
              <>
                <Button
                  mode="contained"
                  icon="flask-outline"
                  accessibilityLabel="Thêm ảnh mẫu DEV"
                  disabled={disabled}
                  onPress={onPress}
                  buttonColor={colors.primary}
                  contentStyle={{ minHeight: 44 }}
                >
                  Ảnh mẫu DEV
                </Button>
                <IconButton
                  icon="minus"
                  iconColor={colors.white}
                  accessibilityLabel="Ẩn công cụ ảnh mẫu DEV"
                  onPress={() => toggle(false)}
                  size={20}
                  style={{ margin: 0, width: 44, height: 44 }}
                />
              </>
            ) : (
              <Button
                mode="contained"
                accessibilityLabel="Mở công cụ ảnh mẫu DEV"
                onPress={() => toggle(true)}
                buttonColor={colors.primary}
                compact
                contentStyle={{ minHeight: 44, minWidth: 44 }}
              >
                DEV
              </Button>
            )}
          </div>,
          host,
        )}
    </>
  );
}
