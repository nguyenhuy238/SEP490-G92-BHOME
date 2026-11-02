import React from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { IconButton, Text } from 'react-native-paper';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { staffColors as s } from '../../theme/theme';

export function IdentityFlowFrame({
  modal,
  visible,
  dark,
  title,
  personLabel,
  onClose,
  children,
}: {
  modal: boolean;
  visible: boolean;
  dark: boolean;
  title: string;
  personLabel: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!modal) return <>{children}</>;
  if (!visible) return null;
  return (
    <Modal
      visible
      transparent={false}
      presentationStyle="fullScreen"
      animationType="slide"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <SafeAreaProvider>
        <SafeAreaView
          style={[styles.root, dark && styles.dark]}
          edges={['top', 'left', 'right', 'bottom']}
        >
          <StatusBar style={dark ? 'light' : 'dark'} />
          <View style={styles.header}>
            <IconButton
              icon="close"
              size={24}
              iconColor={dark ? '#FFFFFF' : s.navy}
              accessibilityLabel="Đóng xác minh CCCD"
              onPress={onClose}
              style={styles.close}
            />
            <View style={styles.heading}>
              <Text style={[styles.title, dark && styles.white]}>{title}</Text>
              <Text style={[styles.person, dark && styles.light]}>{personLabel}</Text>
            </View>
          </View>
          {dark ? (
            <View style={styles.body}>{children}</View>
          ) : (
            <KeyboardAvoidingView
              style={styles.body}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              <ScrollView
                contentContainerStyle={styles.form}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
              >
                {children}
              </ScrollView>
            </KeyboardAvoidingView>
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F7FB' },
  dark: { backgroundColor: '#07121F' },
  body: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 16,
    paddingVertical: 4,
  },
  close: { width: 48, height: 48, margin: 4 },
  heading: { flex: 1, minWidth: 0, gap: 4, paddingVertical: 4 },
  title: { fontSize: 18, lineHeight: 24, fontWeight: '700', color: s.navy },
  person: { fontSize: 13, lineHeight: 19, color: '#475569' },
  white: { color: '#FFFFFF' },
  light: { color: '#CBD5E1' },
  form: {
    padding: 16,
    gap: 16,
    paddingBottom: 24,
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
  },
});
