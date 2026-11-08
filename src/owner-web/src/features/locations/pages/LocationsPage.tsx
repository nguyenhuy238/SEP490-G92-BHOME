import { isMockMode } from '../../../services/config';
import { LiveLocationsPage } from '../../property-api/LivePropertyPages';
import { LocationsListPage } from './LocationsListPage';

export default function LocationsPage() {
  return isMockMode ? <LocationsListPage /> : <LiveLocationsPage />;
}
