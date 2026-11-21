const listeners = new Set<() => void>();
const polling = new WeakMap<
  object,
  { listeners: Set<() => void>; timer: ReturnType<typeof setInterval> }
>();
export const notificationRefresh = {
  emit: () => listeners.forEach((l) => l()),
  subscribe: (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  poll: (scope: object, listener: () => void) => {
    let entry = polling.get(scope);
    if (!entry) {
      const callbacks = new Set<() => void>();
      entry = {
        listeners: callbacks,
        timer: setInterval(() => callbacks.forEach((refresh) => refresh()), 30000),
      };
      polling.set(scope, entry);
    }
    entry.listeners.add(listener);
    return () => {
      entry.listeners.delete(listener);
      if (!entry.listeners.size) {
        clearInterval(entry.timer);
        polling.delete(scope);
      }
    };
  },
};
