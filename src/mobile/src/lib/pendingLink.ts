import type { Href } from 'expo-router';

// A deep link opened before sign-in (e.g. "ký hợp đồng" from an email). It is kept in memory only,
// survives the navigation reset that happens at sign-in, and is used once.
// Read it during render with peekPendingLink (renders may repeat) and clear it in an effect.
let pending: Href | null = null;

export function rememberPendingLink(href: Href) {
  pending = href;
}

export function peekPendingLink(): Href | null {
  return pending;
}

export function clearPendingLink() {
  pending = null;
}
