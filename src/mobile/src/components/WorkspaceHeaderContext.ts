import { createContext, useContext, useEffect } from 'react';

export interface WorkspaceHeaderAction {
  onRefresh: () => void;
  disabled: boolean;
}
export const WorkspaceHeaderContext = createContext<
  ((action: WorkspaceHeaderAction) => () => void) | null
>(null);

export function useWorkspaceHeaderRefresh(onRefresh: () => void, disabled: boolean) {
  const register = useContext(WorkspaceHeaderContext);
  useEffect(() => register?.({ onRefresh, disabled }), [register, onRefresh, disabled]);
  return register !== null;
}
