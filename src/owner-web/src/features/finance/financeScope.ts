import { useContext } from 'react';
import { UNSAFE_LocationContext } from 'react-router';

// The finance pages also render independently in tests and embedded workspaces.
export function useFinanceSearch() {
  const location = useContext(UNSAFE_LocationContext)?.location;
  return new URLSearchParams(location?.search ?? '');
}

export function scopedFinancePath(
  path: string,
  locationId?: string | null,
  extra?: Record<string, string>,
) {
  const query = new URLSearchParams(extra);
  if (locationId) query.set('locationId', locationId);
  return query.size ? `${path}?${query}` : path;
}
