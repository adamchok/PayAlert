'use client'

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { Transaction } from '@/lib/types'

const CHANNEL_COLORS = ['#3b82f6', '#8b5cf6', '#06b6d4', '#10b981', '#f97316', '#ec4899']

interface ChannelPieChartProps {
  items: Transaction[]
}

export function ChannelPieChart({ items }: ChannelPieChartProps) {
  const counts: Record<string, number> = {}
  for (const tx of items) {
    const ch = tx.channel ?? 'OTHER'
    counts[ch] = (counts[ch] ?? 0) + 1
  }
  const data = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({ name, value }))

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Channel Breakdown</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-center h-48 text-[var(--muted-foreground)] text-sm">
          No data
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader><CardTitle>Channel Breakdown</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              outerRadius={85}
              paddingAngle={2}
              dataKey="value"
            >
              {data.map((_, i) => (
                <Cell key={i} fill={CHANNEL_COLORS[i % CHANNEL_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}
              labelStyle={{ color: 'var(--foreground)' }}
              itemStyle={{ color: 'var(--muted-foreground)' }}
            />
            <Legend
              iconType="circle"
              iconSize={8}
              formatter={(value) => <span style={{ color: 'var(--muted-foreground)', fontSize: 12 }}>{value}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
