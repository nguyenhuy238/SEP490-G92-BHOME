export function legacyWorkSearch(search: string, source: 'incidents' | 'maintenance' | 'tasks') {
  const params = new URLSearchParams(search);
  if (source === 'incidents') {
    params.set('view', 'reports');
    params.delete('schedule');
  } else if (source === 'maintenance') {
    params.delete('view');
    params.delete('schedule');
    if (params.has('incidentId')) {
      params.set('incidentFilter', params.get('incidentId')!);
    }
    params.delete('incidentId');
    params.set('maintenance', 'true');
  }
  const result = params.toString();
  return result ? '?' + result : '';
}
