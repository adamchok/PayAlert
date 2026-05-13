'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Filter, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'

const RISK_OPTIONS = ['ALL', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']

interface TransactionsFilterBarProps {
  date: string
  risk: string
  today: string
}

export function TransactionsFilterBar({ date, risk, today }: TransactionsFilterBarProps) {
  const router = useRouter()
  const [localDate, setLocalDate] = useState(date)
  const [localRisk, setLocalRisk] = useState(risk)

  function apply() {
    const params = new URLSearchParams({ date: localDate, risk: localRisk })
    router.push(`/transactions?${params}`)
  }

  function reset() {
    setLocalDate(today)
    setLocalRisk('ALL')
    router.push('/transactions')
  }

  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-[var(--muted-foreground)]" />
            <span className="text-sm font-medium text-[var(--foreground)]">Filter</span>
          </div>

          <Input
            type="date"
            value={localDate}
            max={today}
            onChange={(e) => setLocalDate(e.target.value)}
            className="w-40 h-8 text-xs"
          />

          <select
            value={localRisk}
            onChange={(e) => setLocalRisk(e.target.value)}
            className="h-8 rounded-lg border border-[var(--border)] bg-[var(--card)] text-sm text-[var(--foreground)] px-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {RISK_OPTIONS.map((r) => (
              <option key={r} value={r}>{r === 'ALL' ? 'All Risk Levels' : r}</option>
            ))}
          </select>

          <Button size="sm" onClick={apply}>Apply</Button>
          <Button size="sm" variant="ghost" onClick={reset}>
            <X className="h-3.5 w-3.5 mr-1" /> Reset
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
