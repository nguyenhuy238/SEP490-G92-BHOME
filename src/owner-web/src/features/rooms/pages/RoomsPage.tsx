import { isMockMode } from '../../../services/config';
import { LiveRoomsPage } from '../../property-api/LivePropertyPages';
import { Rooms } from '../../property/Rooms';
import { useParams } from 'react-router';
export default function RoomsPage() {
  const { locationId } = useParams();
  return isMockMode ? <Rooms /> : <LiveRoomsPage forcedLocationId={locationId} />;
}
