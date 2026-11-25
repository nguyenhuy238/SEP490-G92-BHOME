import { createContext, useContext, useEffect, type ReactNode } from 'react';

export interface WorkspaceHeaderAction {
  onRefresh: () => void;
  disabled: boolean;
  title?: string;
  onBack?: () => void;
  footer?: ReactNode;
  action?: {
    icon: string;
    accessibilityLabel: string;
    onPress: () => void;
    disabled?: boolean;
  };
}
export const WorkspaceHeaderContext = createContext<
  ((action: WorkspaceHeaderAction) => () => void) | null
>(null);

export function useWorkspaceHeaderRefresh(
  onRefresh: () => void,
  disabled: boolean,
  options: {
    title?: string;
    onBack?: () => void;
    footer?: ReactNode;
    action?: WorkspaceHeaderAction['action'];
  } = {},
) {
  const register = useContext(WorkspaceHeaderContext);
  const { title, onBack, footer, action } = options;
  useEffect(
    () => register?.({ onRefresh, disabled, title, onBack, footer, action }),
    [register, onRefresh, disabled, title, onBack, footer, action],
  );
  return register !== null;
}
