import { isMockMode } from '../../../services/config';
import { RoomTypes } from '../../property/ConfigurationPages';
import { RoomTypesApiPage } from './RoomTypesApiPage';

export default function RoomTypesPage() {
  return isMockMode ? <RoomTypes /> : <RoomTypesApiPage />;
}
