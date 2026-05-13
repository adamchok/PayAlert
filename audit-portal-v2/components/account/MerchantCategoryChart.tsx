'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { Transaction } from '@/lib/types'

const COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#c084fc', '#06b6d4', '#0891b2', '#0e7490', '#22d3ee', '#67e8f9']

interface MerchantCategoryChartProps {
  items: Transaction[]
}

export function MerchantCategoryChart({ items }: MerchantCategoryChartProps) {
  const counts: Record<string, number> = {}
  for (const tx of items) {
    const cat = tx.merchantCategory ?? 'UNKNOWN'
    counts[cat] = (counts[cat] ?? 0) + 1
  }
  const data = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, value]) => ({ name, value }))

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Top Merchant Categories</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-center h-48 text-[var(--muted-foreground)] text-sm">No data</CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader><CardTitle>Top Merchant Categories</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={data} layout="vertical" barSize={14}>
            <XAxis
              type="number"
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
              width={90}
            />
            <Tooltip
              contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}
              labelStyle={{ color: 'var(--foreground)', fontWeight: 600 }}
              itemStyle={{ color: 'var(--muted-foreground)' }}
              cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
            />
            <Bar dataKey="value" radius={[0, 3, 3, 0]}>
              {data.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
