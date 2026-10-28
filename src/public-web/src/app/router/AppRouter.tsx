
import { Routes, Route, Navigate } from 'react-router';

import PublicLayout from '../../layouts/PublicLayout';
import HomePage from '../../features/home/pages/HomePage';

export default function AppRouter() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route
          path="*"
          element={<Navigate to="/" replace />}
        />
      </Route>
    </Routes>
  );
}
