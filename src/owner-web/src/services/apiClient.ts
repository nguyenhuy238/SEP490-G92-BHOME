import axios from 'axios';
// Auth uses client-core's cookie/JWT client. Business paths are intentionally unconfigured.
export const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  timeout: 15000,
  withCredentials: true,
});
