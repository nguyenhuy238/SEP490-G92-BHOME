export interface DemoClockState {
  enabled: boolean;
  simulated: boolean;
  businessDate: string;
  version: number;
  canChange?: boolean;
}

let current: DemoClockState | null = null;
const listeners = new Set<() => void>();

export function getDemoClockState(): DemoClockState | null {
  return current;
}

export function subscribeDemoClock(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setDemoBusinessDate(state: DemoClockState | null): boolean {
  const next = state?.enabled ? state : null;
  if (
    next?.version === current?.version &&
    next?.businessDate === current?.businessDate &&
    next?.simulated === current?.simulated &&
    next?.canChange === current?.canChange
  )
    return false;
  current = next;
  for (const listener of listeners) listener();
  return true;
}

export function demoBusinessDate(): string | undefined {
  return current?.simulated ? current.businessDate : undefined;
}

export function addDemoDays(date: string, days: number): string {
  const instant = new Date(date + 'T12:00:00Z');
  instant.setUTCDate(instant.getUTCDate() + days);
  return instant.toISOString().slice(0, 10);
}

// Shift the business calendar only. Never use this for tokens, OTPs or network timeouts.
export function demoBusinessNow(real = Date.now()): number {
  const simulatedDate = demoBusinessDate();
  if (!simulatedDate) return real;
  const realDate = new Date(real + 7 * 3600_000).toISOString().slice(0, 10);
  return real + Date.parse(simulatedDate) - Date.parse(realDate);
}
