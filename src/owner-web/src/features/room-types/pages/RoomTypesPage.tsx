import { isMockMode } from '../../../services/config';
import { LiveRoomTypesPage } from '../../property-api/LivePropertyPages';
import { RoomTypes } from '../../property/ConfigurationPages';
import { useParams } from 'react-router';
export default function RoomTypesPage() {
  const { locationId } = useParams();
  return isMockMode ? <RoomTypes /> : <LiveRoomTypesPage forcedLocationId={locationId} />;
}
