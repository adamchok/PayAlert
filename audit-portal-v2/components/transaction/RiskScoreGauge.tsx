'use client'

import { RadialBarChart, RadialBar, ResponsiveContainer } from 'recharts'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { getRiskScoreColor } from '@/lib/utils'

interface RiskScoreGaugeProps {
  score: number
}

export function RiskScoreGauge({ score }: RiskScoreGaugeProps) {
  const color = getRiskScoreColor(score)
  const data = [{ value: score, fill: color }]

  return (
    <Card>
      <CardHeader><CardTitle>Risk Score</CardTitle></CardHeader>
      <CardContent>
        <div className="relative">
          <ResponsiveContainer width="100%" height={180}>
            <RadialBarChart
              innerRadius="60%"
              outerRadius="100%"
              data={data}
              startAngle={180}
              endAngle={0}
            >
              <RadialBar
                dataKey="value"
                cornerRadius={6}
                background={{ fill: 'var(--muted)' }}
              />
            </RadialBarChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-end pb-6">
            <span className="text-4xl font-bold" style={{ color }}>{score}</span>
            <span className="text-xs text-[var(--muted-foreground)] mt-0.5">out of 100</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
