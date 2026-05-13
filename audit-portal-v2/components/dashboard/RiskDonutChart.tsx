'use client'

import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { getRiskColor } from '@/lib/utils'
import type { RiskLevel } from '@/lib/types'

interface RiskDonutChartProps {
  byRisk: Record<RiskLevel, number>
}

const LEVELS: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

export function RiskDonutChart({ byRisk }: RiskDonutChartProps) {
  const data = LEVELS
    .map((level) => ({ name: level, value: byRisk[level] ?? 0 }))
    .filter((d) => d.value > 0)

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader><CardTitle>Risk Distribution</CardTitle></CardHeader>
        <CardContent className="flex items-center justify-center h-48 text-[var(--muted-foreground)] text-sm">
          No data
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader><CardTitle>Risk Distribution</CardTitle></CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={220}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={55}
              outerRadius={85}
              paddingAngle={3}
              dataKey="value"
            >
              {data.map((entry) => (
                <Cell key={entry.name} fill={getRiskColor(entry.name as RiskLevel)} />
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
