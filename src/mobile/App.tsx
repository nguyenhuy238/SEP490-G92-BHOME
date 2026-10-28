
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import {
  PaperProvider,
  MD3LightTheme,
  Appbar,
  Card,
  Text,
  Button,
} from 'react-native-paper';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

const theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: '#1976d2',
  },
};

export default function App() {
  return (
    <SafeAreaProvider>
      <PaperProvider theme={theme}>
        <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
          <Appbar.Header>
            <Appbar.Content
              title="BHOME"
              subtitle="Smart Boarding House Management"
            />
          </Appbar.Header>

          <ScrollView contentContainerStyle={styles.content}>
            <Text variant="headlineMedium">
              Xin chào, Owner!
            </Text>

            <Text variant="bodyMedium" style={styles.subtitle}>
              BHOME Mobile - Expo Demo
            </Text>

            <Card style={styles.card}>
              <Card.Content>
                <Text variant="titleMedium">Tổng số cơ sở</Text>
                <Text variant="headlineLarge">3</Text>
              </Card.Content>
            </Card>

            <Card style={styles.card}>
              <Card.Content>
                <Text variant="titleMedium">Tổng số phòng</Text>
                <Text variant="headlineLarge">45</Text>
              </Card.Content>
            </Card>

            <Card style={styles.card}>
              <Card.Content>
                <Text variant="titleMedium">Phòng đang thuê</Text>
                <Text variant="headlineLarge">38</Text>
              </Card.Content>
            </Card>

            <Button
              mode="contained"
              style={styles.button}
              onPress={() => console.log('BHOME Demo')}
            >
              Bắt đầu sử dụng
            </Button>

            <Text variant="bodySmall" style={styles.note}>
              Dữ liệu mẫu - Chưa kết nối Backend
            </Text>
          </ScrollView>
        </SafeAreaView>
      </PaperProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f7fa',
  },
  content: {
    padding: 20,
  },
  subtitle: {
    marginTop: 8,
    marginBottom: 24,
  },
  card: {
    marginBottom: 16,
  },
  button: {
    marginTop: 20,
  },
  note: {
    marginTop: 16,
    textAlign: 'center',
    color: '#667085',
  },
});
