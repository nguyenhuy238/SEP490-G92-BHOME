export type HouseholdMode = 'family' | 'individual';
export type IdentityStatus = 'unscanned' | 'recognizing' | 'pending' | 'confirmed';
export type IdentitySide = 'front' | 'back';
export type CaptureProgress = Record<IdentitySide, 'unscanned' | 'captured' | 'recognized'>;
export const emptyCaptureProgress = (): CaptureProgress => ({
  front: 'unscanned',
  back: 'unscanned',
});
export interface OnboardingPerson {
  key: string;
  label: string;
  email?: string;
  residentId?: string;
  status: IdentityStatus;
  captureProgress?: CaptureProgress;
  creationUncertain?: boolean;
}
export const onboardingSteps = [
  { key: 'room', label: 'Chọn phòng' },
  { key: 'people', label: 'Người ở' },
  { key: 'identity', label: 'CCCD' },
] as const;
export const identityStatusLabels: Record<IdentityStatus, string> = {
  unscanned: 'Chưa quét',
  recognizing: 'Đang nhận dạng',
  pending: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
};
export function peopleReady(people: readonly OnboardingPerson[], representative: string): boolean {
  return (
    people.length > 0 &&
    people.some((p) => p.key === representative) &&
    people.every(
      (p) =>
        p.label.trim().length > 0 &&
        p.label.trim().length <= 150 &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email?.trim() ?? '') &&
        (p.email?.trim().length ?? 0) <= 256,
    ) &&
    new Set(people.map((p) => p.email?.trim().toLowerCase())).size === people.length
  );
}
export function allIdentitiesConfirmed(people: readonly OnboardingPerson[]): boolean {
  return people.length > 0 && people.every((p) => !!p.residentId && p.status === 'confirmed');
}
export function residentType(mode: HouseholdMode, key: string, representative: string): 0 | 1 {
  return mode === 'individual' || key === representative ? 0 : 1;
}
