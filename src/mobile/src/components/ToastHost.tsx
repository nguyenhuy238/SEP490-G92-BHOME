import React, { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { AccessibilityInfo, Animated, AppState, Platform, StyleSheet, View } from 'react-native';
import { Icon, IconButton, Text } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  clearToasts,
  dismissToast,
  getToastSnapshot,
  registerToastHost,
  subscribeToToast,
  type ToastType,
} from '../lib/toast';
import { colors as c } from '../theme/theme';

const palette: Record<ToastType, { color: string; background: string; icon: string }> = {
  success: { color: c.green, background: c.greenSoft, icon: 'check-circle-outline' },
  error: { color: c.red, background: '#FFF1F0', icon: 'alert-circle-outline' },
  warning: { color: c.amber, background: c.amberSoft, icon: 'alert-outline' },
  info: { color: c.blue, background: c.tint, icon: 'information-outline' },
};
// A single shared renderer, with host arbitration for native Modal windows.
// Only the topmost host displays the message; navigation does not recreate or duplicate it.
export function ToastHost({ modal = false }: { modal?: boolean }) {
  const id = useId();
  const state = useSyncExternalStore(subscribeToToast, getToastSnapshot, getToastSnapshot);
  const insets = useSafeAreaInsets();
  const [progress] = useState(() => new Animated.Value(0));
  const toast = state.host === id ? state.toast : null;
  useEffect(() => registerToastHost(id, modal), [id, modal]);
  useEffect(() => {
    if (modal) return;
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') clearToasts();
    });
    return () => {
      subscription.remove();
      clearToasts();
    };
  }, [modal]);
  useEffect(() => {
    if (!toast) return;
    let stopped = false;
    let animation: Animated.CompositeAnimation | undefined;
    const animate = (reduce: boolean) => {
      if (stopped) return;
      if (!toast.closing) {
        progress.setValue(0);
        if (Platform.OS === 'ios')
          AccessibilityInfo.announceForAccessibility(`${toast.title}. ${toast.message}`);
      }
      animation = Animated.timing(progress, {
        toValue: toast.closing ? 0 : 1,
        duration: reduce ? 0 : toast.closing ? 180 : 220,
        useNativeDriver: true,
      });
      animation.start();
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(animate, () => animate(false));
    return () => {
      stopped = true;
      animation?.stop();
    };
  }, [toast, progress]);
  if (!toast) return null;
  const color = palette[toast.type];
  return (
    <View pointerEvents="box-none" style={[styles.overlay, { top: insets.top + 8 }]}>
      <Animated.View
        testID="bhome-toast"
        accessibilityRole="alert"
        accessibilityLiveRegion={toast.type === 'error' ? 'assertive' : 'polite'}
        style={[
          styles.card,
          {
            opacity: progress,
            transform: [
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) },
            ],
          },
        ]}
      >
        <View style={[styles.icon, { backgroundColor: color.background }]}>
          <Icon source={color.icon} size={24} color={color.color} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: color.color }]}>{toast.title}</Text>
          <Text style={styles.message}>{toast.message}</Text>
        </View>
        <IconButton
          icon="close"
          size={20}
          accessibilityLabel="Đóng thông báo"
          onPress={() => dismissToast(toast.id)}
          style={styles.close}
        />
      </Animated.View>
    </View>
  );
}
export function ToastProvider({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ToastHost />
    </>
  );
}
const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 10000,
    elevation: 24,
    alignItems: 'center',
  },
  card: {
    width: '100%',
    maxWidth: 560,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 12,
    backgroundColor: c.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: c.border,
    elevation: 8,
    boxShadow: '0px 4px 18px rgba(17, 27, 46, 0.14)',
  },
  icon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, minWidth: 0, gap: 4, paddingVertical: 2 },
  title: { fontFamily: 'Inter-SemiBold', fontSize: 14, lineHeight: 20 },
  message: {
    color: c.ink,
    fontFamily: 'Inter-Regular',
    fontSize: 14,
    lineHeight: 21,
    flexShrink: 1,
  },
  close: { margin: -2, width: 44, height: 44 },
});
