const listeners = new Set<() => void>();
export const notificationRefresh = {
  emit: () => listeners.forEach((l) => l()),
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
