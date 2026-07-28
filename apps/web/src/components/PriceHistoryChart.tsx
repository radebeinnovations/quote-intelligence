import type { PriceHistoryPoint } from "@quote-intelligence/domain";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { formatDate, zar } from "../format";

const palette = ["#ff7a45", "#47b39c", "#7c73e6", "#d8a03d", "#e65f8e", "#4f88d4"];

export function PriceHistoryChart({ points }: { points: PriceHistoryPoint[] }) {
  const suppliers = [...new Set(points.map(({ supplierName }) => supplierName))];
  const dates = [...new Set(points.map(({ date }) => date))].sort();
  const data = dates.map((date) => {
    const row: Record<string, string | number> = { date };
    for (const point of points.filter((item) => item.date === date)) {
      row[point.supplierName] = point.rate;
    }
    return row;
  });

  if (!points.length) {
    return <div className="chart-empty">No comparable price history is available yet.</div>;
  }

  return (
    <div className="chart-wrap">
      <ResponsiveContainer width="100%" height={340}>
        <LineChart data={data} margin={{ top: 12, right: 12, left: 12, bottom: 4 }}>
          <CartesianGrid strokeDasharray="4 5" vertical={false} stroke="var(--line)" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(value: number) => `R${Math.round(value)}`}
            tick={{ fill: "var(--muted)", fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            labelFormatter={(label) => formatDate(String(label))}
            formatter={(value) => [zar.format(Number(value)), "Ex-VAT rate"]}
            contentStyle={{
              background: "var(--panel-solid)",
              border: "1px solid var(--line)",
              borderRadius: 12
            }}
          />
          <Legend />
          {suppliers.map((supplier, index) => (
            <Line
              key={supplier}
              type="monotone"
              dataKey={supplier}
              stroke={palette[index % palette.length]}
              strokeWidth={2.5}
              dot={{ r: 4, strokeWidth: 2 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

