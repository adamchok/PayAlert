'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Flag, ArrowUpDown } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { RiskBadge } from '@/components/shared/RiskBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatTimestamp, formatMYR } from '@/lib/utils'
import type { Transaction } from '@/lib/types'

type SortKey = 'timestamp' | 'amountMYR' | 'riskScore'

interface AccountTransactionsTableProps {
  items: Transaction[]
}

export function AccountTransactionsTable({ items }: AccountTransactionsTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('timestamp')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(key); setSortDir('desc') }
  }

  const sorted = [...items].sort((a, b) => {
    const va = a[sortKey] as string | number
    const vb = b[sortKey] as string | number
    return sortDir === 'asc' ? (va < vb ? -1 : 1) : (va > vb ? -1 : 1)
  })

  if (items.length === 0) {
    return (
      <Card><CardContent>
        <EmptyState title="No transactions found" description="Try clearing the date filter." />
      </CardContent></Card>
    )
  }

  function SortHead({ label, field }: { label: string; field: SortKey }) {
    return (
      <TableHead className="cursor-pointer select-none hover:text-[var(--foreground)]" onClick={() => toggleSort(field)}>
        <span className="flex items-center gap-1">{label}<ArrowUpDown className="h-3 w-3 opacity-50" /></span>
      </TableHead>
    )
  }

  return (
    <Card>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHead label="Timestamp" field="timestamp" />
              <TableHead>TX ID</TableHead>
              <SortHead label="Amount (MYR)" field="amountMYR" />
              <TableHead>Merchant</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Channel</TableHead>
              <SortHead label="Score" field="riskScore" />
              <TableHead>Risk</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((tx) => (
              <TableRow key={tx.transactionId} className={
                tx.riskLevel === 'CRITICAL' ? 'bg-red-500/5' :
                tx.riskLevel === 'HIGH' ? 'bg-orange-500/5' : ''
              }>
                <TableCell className="font-mono text-xs text-[var(--muted-foreground)]">
                  {formatTimestamp(tx.timestamp)}
                </TableCell>
                <TableCell>
                  <Link href={`/transaction/${tx.transactionId}`} className="font-mono text-xs text-blue-500 hover:text-blue-400">
                    {tx.transactionId.slice(0, 16)}…
                  </Link>
                </TableCell>
                <TableCell className="font-semibold">{formatMYR(tx.amountMYR)}</TableCell>
                <TableCell className="max-w-[140px] truncate">{tx.merchantName ?? '—'}</TableCell>
                <TableCell className="text-xs">{tx.transactionType ?? '—'}</TableCell>
                <TableCell>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-[var(--muted)] text-[var(--muted-foreground)]">
                    {tx.channel ?? '—'}
                  </span>
                </TableCell>
                <TableCell className="font-mono text-sm">{tx.riskScore}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <RiskBadge level={tx.riskLevel} size="sm" />
                    {tx.isFlagged && <Flag className="h-3 w-3 text-orange-400" />}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
