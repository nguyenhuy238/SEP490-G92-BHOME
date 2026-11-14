import type { OccupancySummary } from '../../property-api/propertyApi';

// The backend snapshot is already Location-scoped and covers all rooms.
// Missing counts must stay unknown; no page-local extrapolation.
export function locationRoomCounts(data?: OccupancySummary) {
  const snapshot = data?.snapshot;
  const count = (value?: number) =>
    value != null && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
  return {
    rooms: count(snapshot?.totalRooms),
    available: count(snapshot?.availableRooms),
    onHold: count(snapshot?.onHoldRooms),
    occupied: count(snapshot?.occupiedRooms),
    unavailable: count(snapshot?.unavailableRooms),
    asOf: data?.asOf,
  };
}
