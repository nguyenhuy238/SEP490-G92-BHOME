import axios from 'axios';
import { apiBaseUrl } from './config';
// Auth uses client-core's cookie/JWT client. Business paths are intentionally unconfigured.
export const apiClient = axios.create({
  baseURL: apiBaseUrl,
  timeout: 15000,
  withCredentials: true,
});
