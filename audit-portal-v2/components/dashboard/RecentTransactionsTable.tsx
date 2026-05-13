'use client'

import Link from 'next/link'
import { Flag } from 'lucide-react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { RiskBadge } from '@/components/shared/RiskBadge'
import { formatTime, formatMYR } from '@/lib/utils'
import type { Transaction } from '@/lib/types'

interface RecentTransactionsTableProps {
  items: Transaction[]
  total: number
  date: string
}

export function RecentTransactionsTable({ items, total, date }: RecentTransactionsTableProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle>Recent Transactions</CardTitle>
        <Link
          href={`/transactions?date=${date}`}
          className="text-xs text-blue-500 hover:text-blue-400 font-medium"
        >
          View all {total} →
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Account</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Merchant</TableHead>
              <TableHead>Channel</TableHead>
              <TableHead>Risk</TableHead>
              <TableHead>Score</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((tx) => (
              <TableRow key={tx.transactionId} className={
                tx.riskLevel === 'CRITICAL' ? 'bg-red-500/5' :
                tx.riskLevel === 'HIGH' ? 'bg-orange-500/5' : ''
              }>
                <TableCell className="font-mono text-xs text-[var(--muted-foreground)]">
                  {formatTime(tx.timestamp)}
                </TableCell>
                <TableCell>
                  <Link href={`/account/${tx.accountId}`} className="text-blue-500 hover:text-blue-400 font-mono text-xs">
                    {tx.accountId}
                  </Link>
                </TableCell>
                <TableCell className="font-semibold">{formatMYR(tx.amountMYR)}</TableCell>
                <TableCell className="max-w-[140px] truncate">{tx.merchantName ?? '—'}</TableCell>
                <TableCell>
                  <span className="text-xs px-2 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)]">
                    {tx.channel ?? '—'}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <RiskBadge level={tx.riskLevel} size="sm" />
                    {tx.isFlagged && <Flag className="h-3 w-3 text-orange-400" />}
                  </div>
                </TableCell>
                <TableCell>
                  <Link href={`/transaction/${tx.transactionId}`} className="font-mono text-xs hover:text-blue-400">
                    {tx.riskScore}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
