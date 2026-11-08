import { createContext, useContext, useEffect, type ReactNode } from 'react';

export interface WorkspaceHeaderAction {
  onRefresh: () => void;
  disabled: boolean;
  title?: string;
  onBack?: () => void;
  footer?: ReactNode;
}
export const WorkspaceHeaderContext = createContext<
  ((action: WorkspaceHeaderAction) => () => void) | null
>(null);

export function useWorkspaceHeaderRefresh(
  onRefresh: () => void,
  disabled: boolean,
  options: { title?: string; onBack?: () => void; footer?: ReactNode } = {},
) {
  const register = useContext(WorkspaceHeaderContext);
  const { title, onBack, footer } = options;
  useEffect(
    () => register?.({ onRefresh, disabled, title, onBack, footer }),
    [register, onRefresh, disabled, title, onBack, footer],
  );
  return register !== null;
}
