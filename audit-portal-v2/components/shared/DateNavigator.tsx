'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface DateNavigatorProps {
  date: string
  prevDate: string
  nextDate: string
  today: string
  basePath: string
  extraParams?: Record<string, string>
}

export function DateNavigator({ date, prevDate, nextDate, today, basePath, extraParams = {} }: DateNavigatorProps) {
  const router = useRouter()
  const isToday = date === today

  function buildUrl(d: string) {
    const params = new URLSearchParams({ date: d, ...extraParams })
    return `${basePath}?${params}`
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Button
        variant="outline"
        size="sm"
        onClick={() => router.push(buildUrl(prevDate))}
        aria-label="Previous day"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <div className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 h-8">
        <Calendar className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
        <input
          type="date"
          value={date}
          max={today}
          onChange={(e) => e.target.value && router.push(buildUrl(e.target.value))}
          className="bg-transparent text-sm text-[var(--foreground)] focus:outline-none"
        />
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={() => router.push(buildUrl(nextDate))}
        disabled={isToday}
        aria-label="Next day"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>

      {!isToday && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => router.push(buildUrl(today))}
        >
          Today
        </Button>
      )}
    </div>
  )
}
