import { createContext } from 'react';

// The navigator owns the persistent tab bar; details retain their existing shell.
export const WorkspaceTabsContext = createContext(false);
