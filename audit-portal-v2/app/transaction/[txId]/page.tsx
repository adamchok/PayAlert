export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { AppShell } from '@/components/layout/AppShell'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { TransactionDetailCards } from '@/components/transaction/TransactionDetailCards'
import { RiskScoreGauge } from '@/components/transaction/RiskScoreGauge'
import { HourlyActivityChart } from '@/components/transaction/HourlyActivityChart'
import { TransactionLocationMap } from '@/components/transaction/TransactionLocationMap'
import { RiskBadge } from '@/components/shared/RiskBadge'
import { Badge } from '@/components/ui/badge'
import { getTransaction, queryByAccount } from '@/lib/queries'
import { Flag } from 'lucide-react'

export default async function TransactionDetailPage({
  params,
}: {
  params: Promise<{ txId: string }>
}) {
  const { txId } = await params
  const tx = await getTransaction(txId)

  if (!tx) notFound()

  // Fetch same-day account transactions for hourly chart
  const accountItems = await queryByAccount(tx.accountId, tx.datePartition, 100)

  const myt = new Date(new Date(tx.timestamp).getTime() + 8 * 3_600_000)
  const highlightHour = myt.getUTCHours()

  return (
    <AppShell>
      <Breadcrumbs />
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1">
            <p className="text-xs text-[var(--muted-foreground)] font-mono mb-1">{tx.transactionId}</p>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Transaction Detail</h1>
          </div>
          <div className="flex items-center gap-2">
            <RiskBadge level={tx.riskLevel} score={tx.riskScore} size="lg" />
            {tx.isFlagged && (
              <Badge variant="flagged" className="text-sm px-3 py-1">
                <Flag className="h-3.5 w-3.5 mr-1.5" />
                Flagged
              </Badge>
            )}
          </div>
        </div>

        {/* 4 detail cards */}
        <TransactionDetailCards tx={tx} />

        {/* Charts row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <RiskScoreGauge score={tx.riskScore} />
          <HourlyActivityChart items={accountItems} highlightHour={highlightHour} />
        </div>

        {/* Location map */}
        <TransactionLocationMap tx={tx} />

        {/* Processing metadata */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <p className="text-xs font-semibold text-[var(--muted-foreground)] uppercase tracking-wide mb-3">Processing Metadata</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
            <div>
              <p className="text-[var(--muted-foreground)]">Processed At</p>
              <p className="font-mono text-[var(--foreground)] mt-0.5">{tx.processedAt ?? '—'}</p>
            </div>
            <div>
              <p className="text-[var(--muted-foreground)]">Date Partition</p>
              <p className="font-mono text-[var(--foreground)] mt-0.5">{tx.datePartition}</p>
            </div>
            <div>
              <p className="text-[var(--muted-foreground)]">Generator Version</p>
              <p className="font-mono text-[var(--foreground)] mt-0.5">{tx.generatorVersion ?? '—'}</p>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  )
}
