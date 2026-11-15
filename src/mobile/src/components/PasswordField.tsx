import React, { useState } from 'react';
import { TextInput } from 'react-native-paper';

export function PasswordField(
  props: Omit<React.ComponentProps<typeof TextInput>, 'secureTextEntry' | 'right'>,
) {
  const [visible, setVisible] = useState(false);
  const label = typeof props.label === 'string' ? props.label.toLowerCase() : 'mật khẩu';
  return (
    <TextInput
      {...props}
      secureTextEntry={!visible}
      autoCapitalize="none"
      autoCorrect={false}
      right={
        <TextInput.Icon
          icon={visible ? 'eye-off' : 'eye'}
          accessibilityLabel={`${visible ? 'Ẩn' : 'Hiện'} ${label}`}
          disabled={props.disabled}
          onPress={() => setVisible((value) => !value)}
        />
      }
    />
  );
}
