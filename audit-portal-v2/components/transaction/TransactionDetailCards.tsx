import Link from 'next/link'
import { Flag } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatTimestamp, formatMYR } from '@/lib/utils'
import type { Transaction } from '@/lib/types'

interface TransactionDetailCardsProps {
  tx: Transaction
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between items-start gap-4 py-2 border-b border-[var(--border)] last:border-0">
      <span className="text-xs text-[var(--muted-foreground)] font-medium shrink-0">{label}</span>
      <span className="text-sm text-[var(--foreground)] text-right font-mono break-all">{value ?? '—'}</span>
    </div>
  )
}

export function TransactionDetailCards({ tx }: TransactionDetailCardsProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* Transaction */}
      <Card>
        <CardHeader><CardTitle>Transaction</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <Row label="ID" value={<span className="text-xs">{tx.transactionId}</span>} />
          <Row label="Timestamp" value={formatTimestamp(tx.timestamp)} />
          <Row label="Type" value={tx.transactionType} />
          <Row label="Channel" value={tx.channel} />
          <Row label="Amount" value={tx.currency !== 'MYR' ? `${tx.amount} ${tx.currency}` : null} />
          <Row label="Amount (MYR)" value={<span className="font-bold text-[var(--foreground)]">{formatMYR(tx.amountMYR)}</span>} />
          {tx.exchangeRate && <Row label="Exchange Rate" value={String(tx.exchangeRate)} />}
          <Row label="Reference" value={tx.referenceId} />
          <Row label="Description" value={<span className="font-sans">{tx.description}</span>} />
        </CardContent>
      </Card>

      {/* Customer & Card */}
      <Card>
        <CardHeader><CardTitle>Customer &amp; Card</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <Row label="Account" value={
            <Link href={`/account/${tx.accountId}`} className="text-blue-500 hover:text-blue-400">
              {tx.accountId}
            </Link>
          } />
          <Row label="Customer ID" value={tx.customerId} />
          <Row label="Name" value={<span className="font-sans">{tx.customerName}</span>} />
          <Row label="Tier" value={tx.customerTier} />
          <Row label="Card Type" value={tx.cardType} />
          <Row label="Card Last 4" value={tx.cardLast4 ? `····${tx.cardLast4}` : undefined} />
        </CardContent>
      </Card>

      {/* Merchant & Location */}
      <Card>
        <CardHeader><CardTitle>Merchant &amp; Location</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <Row label="Merchant" value={<span className="font-sans">{tx.merchantName}</span>} />
          <Row label="Merchant ID" value={tx.merchantId} />
          <Row label="Category" value={tx.merchantCategory} />
          <Row label="City" value={tx.merchantCity} />
          <Row label="State" value={tx.merchantState} />
          <Row label="Country" value={tx.merchantCountry} />
        </CardContent>
      </Card>

      {/* Risk */}
      <Card>
        <CardHeader><CardTitle>Risk Details</CardTitle></CardHeader>
        <CardContent className="pt-0">
          <Row label="Risk Level" value={tx.riskLevel} />
          <Row label="Risk Score" value={
            <span className={tx.riskScore >= 80 ? 'text-red-400 font-bold' : tx.riskScore >= 60 ? 'text-orange-400 font-bold' : 'text-green-400 font-bold'}>
              {tx.riskScore} / 100
            </span>
          } />
          <Row label="Flagged" value={tx.isFlagged ? (
            <span className="flex items-center gap-1 text-orange-400"><Flag className="h-3 w-3" /> Yes</span>
          ) : 'No'} />
          {tx.flagReason && <Row label="Flag Reason" value={<span className="font-sans text-orange-300">{tx.flagReason}</span>} />}
          {tx.riskFlags && tx.riskFlags.length > 0 && (
            <div className="py-2 border-b border-[var(--border)]">
              <p className="text-xs text-[var(--muted-foreground)] font-medium mb-1.5">Risk Flags</p>
              <div className="flex flex-wrap gap-1.5">
                {tx.riskFlags.map((f) => (
                  <Badge key={f} variant="outline" className="text-[10px]">{f}</Badge>
                ))}
              </div>
            </div>
          )}
          {tx.fraudScenario && <Row label="Fraud Scenario" value={<span className="font-sans">{tx.fraudScenario}</span>} />}
        </CardContent>
      </Card>
    </div>
  )
}
