import type { DemoDatabase } from '../types/portal';
export function financeSummary(db: DemoDatabase, locationId = 'all', month = '2024-10') {
  const scoped = (row: { locationId: string; date: string }) =>
    (locationId === 'all' || row.locationId === locationId) && row.date.startsWith(month);
  const invoices = db.records.invoices.filter((row) => scoped(row) && row.status !== 'Nháp');
  const expenses = db.records.expenses.filter(scoped).reduce((sum, row) => sum + row.amount, 0);
  const revenue = invoices.reduce((sum, row) => sum + row.paid, 0);
  const due = invoices.reduce(
    (sum, row) => sum + row.amount + Number(row.attributes.approvedAdjustment || 0),
    0,
  );
  const rooms = db.records.rooms.filter(
    (row) => locationId === 'all' || row.locationId === locationId,
  );
  const occupied = rooms.filter((row) => row.status === 'Đang thuê').length;
  return {
    invoices,
    expenses,
    revenue,
    due,
    debt: Math.max(0, due - revenue),
    profit: revenue - expenses,
    rooms,
    occupied,
    occupancy: (occupied / Math.max(1, rooms.length)) * 100,
    chart: Array.from({ length: 6 }, (_, i) => {
      const ratio = 0.7 + i * 0.06;
      const monthlyRevenue = Math.round(revenue * ratio),
        monthlyExpenses = Math.round(expenses * (0.85 + i * 0.03));
      return {
        name: `T${5 + i}/24`,
        revenue: monthlyRevenue,
        expenses: monthlyExpenses,
        profit: monthlyRevenue - monthlyExpenses,
      };
    }),
  };
}
