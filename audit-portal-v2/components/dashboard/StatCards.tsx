import { AlertTriangle, Activity, TrendingUp, Flag } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { RiskLevel } from '@/lib/types'

interface StatCardsProps {
  total: number
  flagged: number
  byRisk: Record<RiskLevel, number>
}

export function StatCards({ total, flagged, byRisk }: StatCardsProps) {
  const cards = [
    {
      label: 'Total Transactions',
      value: total,
      icon: Activity,
      color: 'text-blue-400',
      border: 'border-l-blue-500',
    },
    {
      label: 'Flagged',
      value: flagged,
      icon: Flag,
      color: 'text-orange-400',
      border: 'border-l-orange-500',
    },
    {
      label: 'High Risk',
      value: byRisk.HIGH ?? 0,
      icon: TrendingUp,
      color: 'text-red-400',
      border: 'border-l-red-500',
    },
    {
      label: 'Critical',
      value: byRisk.CRITICAL ?? 0,
      icon: AlertTriangle,
      color: 'text-red-600',
      border: 'border-l-red-700',
    },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(({ label, value, icon: Icon, color, border }) => (
        <Card key={label} className={`border-l-4 ${border}`}>
          <CardContent className="p-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide">{label}</p>
              <p className="text-3xl font-bold text-[var(--foreground)] mt-1">{value.toLocaleString()}</p>
            </div>
            <Icon className={`h-8 w-8 opacity-70 ${color}`} />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
