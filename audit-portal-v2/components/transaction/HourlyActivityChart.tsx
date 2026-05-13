'use client'

import { AreaChart, Area, XAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { Transaction } from '@/lib/types'

interface HourlyActivityChartProps {
  items: Transaction[]
  highlightHour?: number
}

export function HourlyActivityChart({ items, highlightHour }: HourlyActivityChartProps) {
  const buckets = Array.from({ length: 24 }, (_, h) => ({ hour: h, count: 0, label: `${h}:00` }))
  for (const tx of items) {
    const d = new Date(tx.timestamp)
    // convert UTC to MYT (UTC+8)
    const myt = new Date(d.getTime() + 8 * 3_600_000)
    const hour = myt.getUTCHours()
    buckets[hour].count++
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Hourly Activity (MYT)</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={180}>
          <AreaChart data={buckets}>
            <defs>
              <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }}
              interval={3}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8 }}
              labelStyle={{ color: 'var(--foreground)', fontWeight: 600 }}
              itemStyle={{ color: 'var(--muted-foreground)' }}
            />
            <Area
              type="monotone"
              dataKey="count"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#areaGrad)"
              dot={highlightHour !== undefined
                ? (props) => {
                    if (props.index === highlightHour) {
                      return <circle key={props.key} cx={props.cx} cy={props.cy} r={4} fill="#3b82f6" stroke="#fff" strokeWidth={2} />
                    }
                    return <g key={props.key} />
                  }
                : false
              }
            />
          </AreaChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
