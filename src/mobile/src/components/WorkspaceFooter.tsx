import React, { createContext, useContext, useEffect, type ReactNode } from 'react';

export const WorkspaceFooterContext = createContext<((content: ReactNode) => () => void) | null>(
  null,
);

// A shell-owned slot keeps workflow actions above the existing tab bar, outside the scroll view.
export function WorkspaceFooter({ children }: { children: ReactNode }) {
  const register = useContext(WorkspaceFooterContext);
  useEffect(() => register?.(children), [register, children]);
  return register ? null : <>{children}</>;
}
