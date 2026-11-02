import type { BillingSchedule } from './invoices';
export type AutomationPlan = {
  id: string;
  locationId: string;
  version: number;
  effectiveFrom: string;
  enabled: boolean;
  authorizeAutomaticFinalization: boolean;
  meterDay: number;
  meterDueDay: number;
  meterDueMonthOffset: number;
  billingScheduleVersion: number;
  billingSnapshot: string;
  timeZone: string;
  recordedAt: string;
};
export type AutomationPreview = {
  developerActionsEnabled: boolean;
  timeZone: string;
  businessDate: string;
  phases: { phase: string; scheduledDate: string; eligible: boolean }[];
};
export type AutomationExecution = {
  id: string;
  phase: string;
  status: string;
  attempts: number;
  createdCount: number;
  existingCount: number;
  exceptionsJson: string;
  lastErrorCode: string | null;
  lastStartedAt: string;
  finishedAt: string | null;
  lockedUntil: string | null;
};
export type AutomationAttempt = {
  id: string;
  executionId: string;
  sequence: number;
  status: string;
  summaryJson: string;
  startedAt: string;
  finishedAt: string;
};
export function automationCalendar(plan: AutomationPlan): BillingSchedule | null {
  try {
    const raw = JSON.parse(plan.billingSnapshot) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(raw).map(([k, v]) => [k[0].toLowerCase() + k.slice(1), v]),
    ) as unknown as BillingSchedule;
  } catch {
    return null;
  }
}
export function automationIssues(
  json: string,
): { roomId?: string; code: string; taskId?: string }[] {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((x) => x && typeof x.code === 'string') : [];
  } catch {
    return [];
  }
}
