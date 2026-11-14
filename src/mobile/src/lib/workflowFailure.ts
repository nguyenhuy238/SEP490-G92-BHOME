// Log only allowlisted transport diagnostics. Never log an error object, payload or identity fields.
export function workflowFailure(workflow: 'identity' | 'main-draft', error: unknown) {
  const value = error as { status?: number; correlationId?: string } | null;
  const correlationId = value?.correlationId;
  if (typeof correlationId === 'string' && /^[a-f0-9-]{36}$/i.test(correlationId))
    console.warn('BHOME workflow request failed', {
      workflow,
      status: value?.status,
      correlationId,
    });
}
