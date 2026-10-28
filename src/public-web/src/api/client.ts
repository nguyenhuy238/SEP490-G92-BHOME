import { createApiClient } from '@bhome/client-core/api.ts';
import { apiBaseUrl } from './config';
// Public endpoints must explicitly allow anonymous access and return approved public DTOs.
export const publicApi = createApiClient(apiBaseUrl);
