import { isMockMode } from '../../../services/config';
import { LiveAssetsPage } from '../../property-api/LivePropertyPages';
import { Assets } from '../../property/Assets';
import { useParams } from 'react-router';
export default function AssetsPage() {
  const { locationId } = useParams();
  return isMockMode ? <Assets /> : <LiveAssetsPage forcedLocationId={locationId} />;
}
