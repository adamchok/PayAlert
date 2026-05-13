import { AppShell } from '@/components/layout/AppShell'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { StatCards } from '@/components/dashboard/StatCards'
import { RiskDonutChart } from '@/components/dashboard/RiskDonutChart'
import { VolumeBarChart } from '@/components/dashboard/VolumeBarChart'
import { ChannelPieChart } from '@/components/dashboard/ChannelPieChart'
import { RecentTransactionsTable } from '@/components/dashboard/RecentTransactionsTable'
import { DateNavigator } from '@/components/shared/DateNavigator'
import { AutoRefresh } from '@/components/shared/AutoRefresh'
import { queryByDate, queryLastNDays } from '@/lib/queries'
import { todayMYT, dateNeighbors } from '@/lib/utils'
import type { RiskLevel } from '@/lib/types'

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const { date: rawDate } = await searchParams
  const today = todayMYT()
  const date = rawDate ?? today
  const { prev, next } = dateNeighbors(date, today)

  const [{ items }, volumeData] = await Promise.all([
    queryByDate(date, 'ALL', 500),
    queryLastNDays(7),
  ])

  const byRisk: Record<RiskLevel, number> = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 }
  let flagged = 0
  for (const tx of items) {
    byRisk[tx.riskLevel] = (byRisk[tx.riskLevel] ?? 0) + 1
    if (tx.isFlagged) flagged++
  }

  return (
    <AppShell>
      <Breadcrumbs />
      <div className="space-y-6">
        {/* Header row */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Dashboard</h1>
            <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
              {items.length} transactions on {date}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <AutoRefresh intervalMs={30000} />
            <DateNavigator
              date={date}
              prevDate={prev}
              nextDate={next}
              today={today}
              basePath="/dashboard"
            />
          </div>
        </div>

        {/* Stat cards */}
        <StatCards total={items.length} flagged={flagged} byRisk={byRisk} />

        {/* Charts row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <RiskDonutChart byRisk={byRisk} />
          <VolumeBarChart data={volumeData} />
          <ChannelPieChart items={items} />
        </div>

        {/* Recent transactions */}
        <RecentTransactionsTable
          items={items.slice(0, 20)}
          total={items.length}
          date={date}
        />
      </div>
    </AppShell>
  )
}
