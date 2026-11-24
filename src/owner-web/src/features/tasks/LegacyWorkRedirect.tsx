import { Navigate, useLocation } from 'react-router';
import { legacyWorkSearch } from './legacyWorkSearch';

export function LegacyWorkRedirect({ source }: { source: 'incidents' | 'maintenance' | 'tasks' }) {
  const location = useLocation();
  return (
    <Navigate
      replace
      to={{
        pathname: '/operational-tasks',
        search: legacyWorkSearch(location.search, source),
        hash: location.hash,
      }}
    />
  );
}
