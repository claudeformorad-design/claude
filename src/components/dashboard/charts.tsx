"use client";

import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const fmt = (locale: string) => (v: number) =>
  new Intl.NumberFormat(locale === "ar" ? "ar-SA-u-nu-latn" : "en-US", { maximumFractionDigits: 0 }).format(v);

// لوحة ألوان محايدة متباينة (مريحة في الوضعين)
const PALETTE = ["#0f766e", "#2563eb", "#d97706", "#7c3aed", "#db2777", "#65a30d", "#0891b2", "#dc2626"];

export function RevenueExpenseChart({ data, locale, labels }: {
  data: { month: string; revenue: number; expenses: number }[]; locale: string; labels: { revenue: string; expenses: string };
}) {
  const f = fmt(locale);
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
        <XAxis dataKey="month" tick={{ fontSize: 12 }} reversed={locale === "ar"} />
        <YAxis tickFormatter={f} tick={{ fontSize: 12 }} width={70} orientation={locale === "ar" ? "right" : "left"} />
        <Tooltip formatter={(v) => f(Number(v))} />
        <Legend />
        <Bar dataKey="revenue" name={labels.revenue} fill="#0f766e" radius={[4, 4, 0, 0]} />
        <Bar dataKey="expenses" name={labels.expenses} fill="#d97706" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DepartmentRevenueChart({ data, locale }: { data: { name: string; value: number }[]; locale: string }) {
  const f = fmt(locale);
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>
          {data.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
        </Pie>
        <Tooltip formatter={(v) => f(Number(v))} />
        <Legend />
      </PieChart>
    </ResponsiveContainer>
  );
}
