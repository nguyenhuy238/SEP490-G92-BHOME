// Real backend is the default. Demo data requires an explicit opt-in.
export const isMockMode = import.meta.env.VITE_API_MODE === 'mock';
