import { AppShell } from '@/components/layout/AppShell'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { TransactionsFilterBar } from '@/components/transactions/TransactionsFilterBar'
import { TransactionsTable } from '@/components/transactions/TransactionsTable'
import { RiskScoreHistogram } from '@/components/transactions/RiskScoreHistogram'
import { ExportButton } from '@/components/transactions/ExportButton'
import { AutoRefresh } from '@/components/shared/AutoRefresh'
import { queryByDate } from '@/lib/queries'
import { todayMYT } from '@/lib/utils'

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; risk?: string }>
}) {
  const { date: rawDate, risk: rawRisk } = await searchParams
  const today = todayMYT()
  const date = rawDate ?? today
  const risk = rawRisk ?? 'ALL'

  const { items, nextCursor } = await queryByDate(date, risk, 50)

  return (
    <AppShell>
      <Breadcrumbs />
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Transactions</h1>
            <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
              {items.length} loaded · {date}{risk !== 'ALL' ? ` · ${risk}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <AutoRefresh intervalMs={30000} />
            <ExportButton items={items} filename={`transactions-${date}.csv`} />
          </div>
        </div>

        <TransactionsFilterBar date={date} risk={risk} today={today} />
        <RiskScoreHistogram items={items} />
        <TransactionsTable
          items={items}
          nextCursor={nextCursor}
          date={date}
          risk={risk}
        />
      </div>
    </AppShell>
  )
}
