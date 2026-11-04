export type ToastType = 'success' | 'error' | 'warning' | 'info';
export interface ToastMessage {
  id: number;
  type: ToastType;
  title: string;
  message: string;
  duration: number;
  closing: boolean;
}
const durations: Record<ToastType, number> = {
  success: 3000,
  error: 5000,
  warning: 4000,
  info: 3000,
};
const titles: Record<ToastType, string> = {
  success: 'Thành công',
  error: 'Chưa hoàn tất',
  warning: 'Cần kiểm tra',
  info: 'Thông tin',
};
let snapshot: { toast: ToastMessage | null; host: string | null } = { toast: null, host: null };
let sequence = 0;
let hosts: string[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const publish = (next: typeof snapshot) => {
  snapshot = next;
  listeners.forEach((listener) => listener());
};
export const subscribeToToast = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export const getToastSnapshot = () => snapshot;

// Ordinary UI copy excludes request paths, UUIDs and connection configuration instructions.
// The original API error object keeps its diagnostics for the existing diagnostic tooling.
export function conciseMessage(value: string): string {
  const message = value
    .split(/\s*[·•]\s*(?=(?:GET|POST|PUT|PATCH|DELETE|HTTP)\b|Mã truy vết)/i)[0]!
    .replace(/\s*API nội bộ cần[\s\S]*$/i, '')
    .replace(/\s*(?:Mã truy vết|Correlation ID)\s*:[\s\S]*$/i, '')
    .replace(/\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/api\/\S+/g, '')
    .trim();
  if (!message) return 'Không thể hoàn tất. Vui lòng thử lại.';
  // Never expose raw runtime exceptions or backend identifiers as the user's instructions.
  if (
    /^(?:TypeError|SyntaxError|Error:|Cannot |Network request failed)|^[a-z][a-z0-9]+(?:_[a-z0-9]+)+$/.test(
      message,
    )
  )
    return 'Không thể hoàn tất. Vui lòng thử lại.';
  if (message.length <= 260) return message;
  const first = message.split(/(?<=[.!?])\s|\n/)[0]!;
  return first.length <= 220
    ? first + ' Kiểm tra thông tin trên màn hình để tiếp tục.'
    : 'Chưa thể hoàn tất. Kiểm tra thông tin trên màn hình rồi thử lại.';
}
export function finishToast(id: number) {
  if (snapshot.toast?.id === id) publish({ ...snapshot, toast: null });
}
export function dismissToast(id = snapshot.toast?.id) {
  if (!id || snapshot.toast?.id !== id || snapshot.toast.closing) return;
  clearTimeout(timer);
  publish({ ...snapshot, toast: { ...snapshot.toast, closing: true } });
  timer = setTimeout(() => finishToast(id), 200);
}
export function clearToasts() {
  clearTimeout(timer);
  publish({ ...snapshot, toast: null });
}
export function showToast(type: ToastType, message: string, title = titles[type]) {
  const text = conciseMessage(message);
  if (!message.trim()) return;
  if (
    snapshot.toast &&
    !snapshot.toast.closing &&
    snapshot.toast.type === type &&
    snapshot.toast.message === text &&
    snapshot.toast.title === title
  )
    return;
  clearTimeout(timer);
  const toast: ToastMessage = {
    id: ++sequence,
    type,
    title: conciseMessage(title),
    message: text,
    duration: durations[type],
    closing: false,
  };
  publish({ ...snapshot, toast });
  timer = setTimeout(() => dismissToast(toast.id), toast.duration);
}
export const showSuccess = (message: string, title?: string) =>
  showToast('success', message, title);
export const showError = (message: string, title?: string) => showToast('error', message, title);
export const showWarning = (message: string, title?: string) =>
  showToast('warning', message, title);
export const showInfo = (message: string, title?: string) => showToast('info', message, title);
export function registerToastHost(id: string, modal: boolean) {
  hosts = modal ? [...hosts, id] : [id, ...hosts];
  publish({ ...snapshot, host: hosts.at(-1) ?? null });
  return () => {
    hosts = hosts.filter((host) => host !== id);
    publish({ ...snapshot, host: hosts.at(-1) ?? null });
  };
}
