import { AppShell } from '@/components/layout/AppShell'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { CustomerInfoStrip } from '@/components/account/CustomerInfoStrip'
import { AccountTransactionsTable } from '@/components/account/AccountTransactionsTable'
import { MerchantCategoryChart } from '@/components/account/MerchantCategoryChart'
import { AccountGeoMap } from '@/components/account/AccountGeoMap'
import { DateNavigator } from '@/components/shared/DateNavigator'
import { queryByAccount } from '@/lib/queries'
import { todayMYT, dateNeighbors } from '@/lib/utils'

export default async function AccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>
  searchParams: Promise<{ date?: string }>
}) {
  const { accountId } = await params
  const { date: rawDate } = await searchParams
  const today = todayMYT()

  const items = await queryByAccount(accountId, rawDate, 100)
  const flagged = items.filter((tx) => tx.isFlagged).length

  const displayDate = rawDate ?? today
  const { prev, next } = dateNeighbors(displayDate, today)

  return (
    <AppShell>
      <Breadcrumbs />
      <div className="space-y-6">
        <CustomerInfoStrip
          accountId={accountId}
          item={items[0]}
          total={items.length}
          flagged={flagged}
        />

        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--muted-foreground)]">Filter by date:</span>
          <DateNavigator
            date={displayDate}
            prevDate={prev}
            nextDate={next}
            today={today}
            basePath={`/account/${accountId}`}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <MerchantCategoryChart items={items} />
          <AccountGeoMap items={items} />
        </div>

        <AccountTransactionsTable items={items} />
      </div>
    </AppShell>
  )
}
