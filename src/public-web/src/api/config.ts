import { getApiBaseUrl } from '@bhome/client-core/config.ts';
export const apiBaseUrl = getApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.DEV);
