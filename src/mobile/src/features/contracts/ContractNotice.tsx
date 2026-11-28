import React from 'react';
import { Text } from 'react-native-paper';
import { conciseMessage } from '../../lib/toast';

export function ContractNotice({ message }: { message: string }) {
  return (
    <Text accessibilityRole="alert" style={styles.notice}>
      {conciseMessage(message)}
    </Text>
  );
}

const styles = {
  notice: {
    color: '#304A66',
    backgroundColor: '#EEF3F8',
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    lineHeight: 21,
  },
};
