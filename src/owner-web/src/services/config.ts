import { getApiBaseUrl } from '../../../../packages/client-core/src/config';

// Real backend is the default. Demo data requires an explicit opt-in.
export const isMockMode = import.meta.env.VITE_API_MODE === 'mock';

// Vite verifies the upstream API certificate. Browsers use the portal origin
// for every API request, including business pages and authentication cookies.
export const apiBaseUrl =
  isMockMode || import.meta.env.DEV ? '' : getApiBaseUrl(import.meta.env.VITE_API_BASE_URL, false);
