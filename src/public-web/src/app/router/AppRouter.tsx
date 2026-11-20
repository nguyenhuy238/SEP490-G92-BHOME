import { Routes, Route } from 'react-router';

import PublicLayout from '../../layouts/PublicLayout';
import HomePage from '../../features/home/pages/HomePage';
import {
  LocationsPage,
  LocationPage,
  RoomPage,
  NotFoundPage,
} from '../../features/home/pages/PublicContentPages';

export default function AppRouter() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/locations" element={<LocationsPage />} />
        <Route path="/locations/:id" element={<LocationPage />} />
        <Route path="/rooms/:id" element={<RoomPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
