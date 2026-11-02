import { uuid } from 'expo';

// Expo Core provides native UUID v4 generation without loading ExpoCrypto.
// Keep native failures visible; mutation keys must never use a weak random fallback.
export function randomUUID(): string {
  return uuid.v4();
}
