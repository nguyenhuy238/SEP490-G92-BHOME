import { TextField } from '../../../components/common/ValidatedForm';
import { useState } from 'react';
import { IconButton, InputAdornment, type TextFieldProps } from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';

export function PasswordField(props: Omit<TextFieldProps, 'type' | 'slotProps'>) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...props}
      type={visible ? 'text' : 'password'}
      slotProps={{
        htmlInput: { maxLength: 1024 },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                type="button"
                edge="end"
                disabled={props.disabled}
                aria-label={`${visible ? 'Ẩn' : 'Hiện'} ${typeof props.label === 'string' ? props.label.toLowerCase() : 'mật khẩu'}`}
                aria-pressed={visible}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setVisible((value) => !value)}
              >
                {visible ? <VisibilityOff /> : <Visibility />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
