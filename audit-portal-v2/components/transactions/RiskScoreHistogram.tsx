'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { Transaction } from '@/lib/types'

const BIN_COLORS = [
  '#22c55e', '#22c55e', '#4ade80', '#84cc16',
  '#eab308', '#eab308', '#f97316', '#f97316',
  '#dc2626', '#dc2626',
]

interface RiskScoreHistogramProps {
  items: Transaction[]
}

export function RiskScoreHistogram({ items }: RiskScoreHistogramProps) {
  const bins = Array.from({ length: 10 }, (_, i) => ({
    range: `${i * 10}–${i * 10 + 9}`,
    count: 0,
  }))

  for (const tx of items) {
    const bin = Math.min(Math.floor(tx.riskScore / 10), 9)
    bins[bin].count++
  }

  return (
    <Card>
      <CardHeader><CardTitle>Risk Score Distribution</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={bins} barSize={24}>
            <XAxis
              dataKey="range"
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
              axisLine={false}
              tickLine={false}
              width={28}
            />
            <Tooltip
              contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}
              labelStyle={{ color: 'var(--foreground)', fontWeight: 600 }}
              itemStyle={{ color: 'var(--muted-foreground)' }}
              cursor={{ fill: 'var(--muted)', opacity: 0.5 }}
            />
            <Bar dataKey="count" radius={[3, 3, 0, 0]}>
              {bins.map((_, i) => (
                <Cell key={i} fill={BIN_COLORS[i]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
