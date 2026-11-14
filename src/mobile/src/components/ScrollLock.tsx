import { createContext, useContext } from 'react';

// Lets a child that owns a drag gesture (e.g. the signature pad) stop the surrounding page
// ScrollView from scrolling while the finger is down. Outside a scroll view it is a no-op.
export const ScrollLockContext = createContext<(locked: boolean) => void>(() => {});

export function useScrollLock() {
  return useContext(ScrollLockContext);
}
