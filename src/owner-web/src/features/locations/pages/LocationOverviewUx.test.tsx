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
            assets: 0,
            assetTemplates: 2,
            pricesAndFees: 6,
            rules: 0,
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('75% đang cho thuê')).toBeInTheDocument();
    expect(
      screen.getByRole('img', { name: /Đang cho thuê: 18.*Phòng trống: 4/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('2 bộ định mức · tài sản thực tế')).toBeInTheDocument();
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
});
