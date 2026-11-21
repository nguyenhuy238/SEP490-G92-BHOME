import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { locationRoomCounts } from './locationOverviewData';
import { LocationWorkspaceOverview } from './LocationWorkspaceOverview';

afterEach(cleanup);

describe('Location overview UX', () => {
  it('uses the backend snapshot and does not derive counts from a room page', () => {
    expect(
      locationRoomCounts({
        locationId: 'location',
        asOf: '2026-11-13',
        snapshot: {
          totalRooms: 24,
          availableRooms: 4,
          occupiedRooms: 18,
          onHoldRooms: 1,
          unavailableRooms: 1,
          occupancyRate: 0,
        },
      }),
    ).toMatchObject({ rooms: 24, occupied: 18, available: 4, onHold: 1, unavailable: 1 });
    expect(locationRoomCounts().occupied).toBeUndefined();
  });

  it('shows a truthful current occupancy ratio and the state distribution', () => {
    render(
      <MemoryRouter>
        <LocationWorkspaceOverview
          id="location"
          active
          owner
          loading={false}
          summary={{
            rooms: 24,
            available: 4,
            occupied: 18,
            onHold: 1,
            unavailable: 1,
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('75% đang cho thuê')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Đang cho thuê: 18.*Phòng trống: 4/ }),
    ).toBeInTheDocument();
    const donut = screen.getByRole('img', { name: /Đang cho thuê: 18.*Phòng trống: 4/ });
    expect(donut.querySelectorAll('circle[pathLength="100"]')).toHaveLength(4);
    expect(donut.querySelector('circle[stroke-dasharray="75 25"]')).toBeInTheDocument();
    expect(screen.queryByText('Cấu hình cơ sở')).not.toBeInTheDocument();
    expect(screen.queryByText('Phòng đang cho thuê')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Kiểm kê tài sản' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Xem sự cố' })).toHaveAttribute(
      'href',
      '/incidents?locationId=location',
    );
  });

  it('does not calculate an occupancy percentage from missing or inconsistent counts', () => {
    const { rerender } = render(
      <MemoryRouter>
        <LocationWorkspaceOverview
          id="location"
          active
          owner
          loading={false}
          summary={{ rooms: 24, occupied: 18, available: 4 }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Chưa đủ số liệu')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <LocationWorkspaceOverview
          id="location"
          active
          owner
          loading={false}
          summary={{ rooms: 24, occupied: 18, available: 4, onHold: 1, unavailable: 3 }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Chưa đủ số liệu')).toBeInTheDocument();
    expect(screen.queryByText(/% đang cho thuê/)).not.toBeInTheDocument();
  });

  it('distinguishes empty and inactive from missing and hides owner-only actions', () => {
    render(
      <MemoryRouter>
        <LocationWorkspaceOverview
          id="location"
          active={false}
          owner={false}
          loading={false}
          summary={{ rooms: 0, occupied: 0, available: 0, onHold: 0, unavailable: 0 }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('Chưa có phòng')).toBeInTheDocument();
    expect(screen.getByText('Chuẩn bị vận hành')).toBeInTheDocument();
    expect(screen.queryByText('75% đang cho thuê')).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Xem sự cố' })).not.toBeInTheDocument();
  });

  it('groups known zero follow-ups without treating missing incident data as healthy', () => {
    const { rerender } = render(
      <MemoryRouter>
        <LocationWorkspaceOverview
          id="location"
          active
          owner
          loading={false}
          summary={{
            rooms: 3,
            occupied: 1,
            available: 1,
            onHold: 1,
            unavailable: 0,
            openIncidents: 0,
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /Không có sự cố đang mở/ })).toHaveAttribute(
      'href',
      '/incidents?locationId=location',
    );
    expect(screen.getByRole('link', { name: /Không có phòng ngừng khai thác/ })).toHaveAttribute(
      'href',
      '/locations/location/rooms?roomStatus=3',
    );
    expect(screen.getByRole('link', { name: 'Xem giữ chỗ' })).toHaveAttribute(
      'href',
      '/locations/location/rooms?roomStatus=1',
    );
    rerender(
      <MemoryRouter>
        <LocationWorkspaceOverview
          id="location"
          active
          owner
          loading={false}
          summary={{ rooms: 3, occupied: 1, available: 1, onHold: 1, unavailable: 0 }}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText('Không có sự cố đang mở')).not.toBeInTheDocument();
    expect(screen.getByText('Chưa có số liệu')).toBeInTheDocument();
  });
});
