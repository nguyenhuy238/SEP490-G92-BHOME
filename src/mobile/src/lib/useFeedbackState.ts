import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { conciseMessage, showToast, type ToastType } from './toast';

// Keep actionable feedback inline (including field validation), and announce it once at the top.
// State setters do not show notifications on render, and clearing a field never emits a toast.
export function useFeedbackState(
  type: ToastType = 'error',
  announce = true,
): [string, Dispatch<SetStateAction<string>>] {
  const [message, setMessage] = useState('');
  const current = useRef('');
  const setFeedback = useCallback<Dispatch<SetStateAction<string>>>(
    (next) => {
      const raw = typeof next === 'function' ? next(current.current) : next;
      const text = raw ? conciseMessage(raw) : '';
      current.current = text;
      setMessage(text);
      if (text && announce) showToast(type, text);
    },
    [type, announce],
  );
  return [message, setFeedback];
}
