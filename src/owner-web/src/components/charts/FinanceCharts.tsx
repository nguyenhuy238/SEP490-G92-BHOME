import { Box } from '@mui/material';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { compactMoney } from '../../utils/format';
export interface FinancePoint {
  name: string;
  revenue: number;
  expenses: number;
  profit: number;
}
export function FinanceChart({ data }: { data: FinancePoint[] }) {
  return (
    <Box
      sx={{ width: '100%', height: 270, minWidth: 0 }}
      aria-label="Biểu đồ doanh thu, chi phí và lợi nhuận"
    >
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ left: 0, right: 12, bottom: 0, top: 12 }}>
          <CartesianGrid stroke="#eaedff" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
          <YAxis
            tickFormatter={(value) => `${Math.round(Number(value) / 1000000)}M`}
            tick={{ fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip formatter={(value) => compactMoney(Number(value))} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar
            dataKey="revenue"
            name="Doanh thu"
            fill="#2563eb"
            radius={[3, 3, 0, 0]}
            maxBarSize={24}
          />
          <Bar
            dataKey="expenses"
            name="Chi phí"
            fill="#b7c8e1"
            radius={[3, 3, 0, 0]}
            maxBarSize={24}
          />
          <Line
            type="monotone"
            dataKey="profit"
            name="Lợi nhuận"
            stroke="#007f36"
            strokeWidth={2}
            dot={{ r: 3 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </Box>
  );
}
export function CollectionChart({ data }: { data: { name: string; value: number }[] }) {
  return (
    <Box sx={{ height: 200, width: '100%', minWidth: 0 }} aria-label="Biểu đồ cơ cấu">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="45%"
            innerRadius={48}
            outerRadius={68}
            paddingAngle={2}
          >
            {data.map((row, i) => (
              <Cell key={row.name} fill={['#007f36', '#2563eb', '#ba1a1a', '#7c8eaf'][i % 4]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => compactMoney(Number(value))} />
          <Legend wrapperStyle={{ fontSize: 10 }} />
        </PieChart>
      </ResponsiveContainer>
    </Box>
  );
}
