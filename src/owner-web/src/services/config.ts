// Real Backend data is the safe default. Demo data must be explicitly enabled so
// a missing/misspelled environment variable cannot silently bypass API calls.
export const isMockMode = import.meta.env.VITE_API_MODE === 'mock';
