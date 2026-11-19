import { useId, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  type ButtonProps,
} from '@mui/material';

/** Keep review and execution separate. A changed source/form must be reviewed again. */
export function ConfirmActionButton({
  title,
  description,
  confirmationKey,
  onConfirm,
  children,
  disabled,
  ...button
}: Omit<ButtonProps, 'onClick' | 'title'> & {
  title: string;
  description: ReactNode;
  confirmationKey: string;
  onConfirm: () => Promise<void>;
}) {
  const [openedKey, setOpenedKey] = useState<string | null>(null);
  const titleId = useId();
  const [pending, setPending] = useState(false);
  const lock = useRef(false);
  const changed = openedKey !== null && openedKey !== confirmationKey;
  return (
    <>
      <Button
        {...button}
        disabled={disabled || pending}
        onClick={() => setOpenedKey(confirmationKey)}
      >
        {children}
      </Button>
      <Dialog
        open={openedKey !== null}
        onClose={() => !pending && setOpenedKey(null)}
        maxWidth="sm"
        fullWidth
        aria-labelledby={titleId}
      >
        <DialogTitle id={titleId}>{title}</DialogTitle>
        <DialogContent>
          <DialogContentText component="div">{description}</DialogContentText>
          {changed && (
            <Alert severity="warning">
              Dữ liệu đã thay đổi. Đóng xác nhận và kiểm tra lại trước khi tiếp tục.
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button disabled={pending} onClick={() => setOpenedKey(null)}>
            Quay lại
          </Button>
          <Button
            variant="contained"
            disabled={disabled || pending || changed}
            onClick={async () => {
              if (lock.current || changed || disabled) return;
              lock.current = true;
              setPending(true);
              try {
                await onConfirm();
                setOpenedKey(null);
              } finally {
                lock.current = false;
                setPending(false);
              }
            }}
          >
            {pending ? 'Đang xử lý…' : 'Xác nhận thực hiện'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
