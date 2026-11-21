import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OwnerLocationPicker, OwnerRoomPicker } from './OwnerSelectors';
const mocks = vi.hoisted(() => ({ request: vi.fn(), role: 'Owner' }));
vi.mock('../../features/meters/useMeterApi', () => ({
  useMeterApi: () => ({ request: mocks.request }),
}));
vi.mock('../../../../../packages/client-core/src/auth', () => ({
  useAuth: () => ({ session: { userId: 'synthetic-owner', roles: [mocks.role] } }),
}));
beforeEach(() => {
  mocks.role = 'Owner';
  mocks.request.mockReset();
  mocks.request.mockResolvedValue({
    items: [{ id: 'location-1', name: 'Cơ sở tổng hợp' }],
    totalCount: 1,
  });
});
afterEach(cleanup);
function mount(children: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {children}
    </QueryClientProvider>,
  );
}
function Picker() {
  const [value, change] = useState('');
  return <OwnerLocationPicker value={value} change={change} />;
}
it('selects a readable label with the keyboard and searches on the server', async () => {
  mount(<Picker />);
  const input = screen.getByRole('combobox', { name: 'Cơ sở' });
  fireEvent.focus(input);
  await screen.findByRole('option', { name: 'Cơ sở tổng hợp' });
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(input).toHaveValue('Cơ sở tổng hợp');
  fireEvent.change(input, { target: { value: 'tổng hợp' } });
  await waitFor(() =>
    expect(mocks.request).toHaveBeenCalledWith(
      expect.stringContaining('search=t%E1%BB%95ng+h%E1%BB%A3p'),
      expect.anything(),
    ),
  );
  expect(screen.queryByText('Trang trước')).not.toBeInTheDocument();
});
it('loads later results by scrolling instead of inserting pagination buttons', async () => {
  mocks.request.mockImplementation(async (path: string) => ({
    items: path.includes('page=2')
      ? [{ id: 'location-2', name: 'Cơ sở trang hai' }]
      : [{ id: 'location-1', name: 'Cơ sở trang một' }],
    totalCount: 2,
  }));
  mount(<Picker />);
  fireEvent.focus(screen.getByRole('combobox', { name: 'Cơ sở' }));
  const list = await screen.findByRole('listbox');
  fireEvent.scroll(list);
  expect(await screen.findByRole('option', { name: 'Cơ sở trang hai' })).toBeInTheDocument();
});
it('shows an API failure with retry without presenting an empty result as success', async () => {
  mocks.request.mockRejectedValueOnce(new Error('Synthetic network failure'));
  mount(<Picker />);
  fireEvent.focus(screen.getByRole('combobox', { name: 'Cơ sở' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Thử lại cơ sở' }));
  expect(await screen.findByRole('option', { name: 'Cơ sở tổng hợp' })).toBeInTheDocument();
});
it('does not load Room choices without a Location or load Owner choices as Staff', async () => {
  const view = mount(<OwnerRoomPicker location="" value="" change={vi.fn()} />);
  expect(screen.getByRole('combobox', { name: 'Phòng' })).toBeDisabled();
  expect(mocks.request).not.toHaveBeenCalled();
  view.unmount();
  mocks.role = 'Staff';
  mount(<Picker />);
  await Promise.resolve();
  expect(mocks.request).not.toHaveBeenCalled();
});
