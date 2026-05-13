'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Flag, ArrowUpDown, Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'
import { RiskBadge } from '@/components/shared/RiskBadge'
import { EmptyState } from '@/components/shared/EmptyState'
import { formatTime, formatMYR } from '@/lib/utils'
import type { Transaction } from '@/lib/types'

type SortKey = 'timestamp' | 'amountMYR' | 'riskScore'
type SortDir = 'asc' | 'desc'

interface TransactionsTableProps {
  items: Transaction[]
  nextCursor?: string | null
  date: string
  risk: string
}

export function TransactionsTable({ items, nextCursor: initialCursor, date, risk }: TransactionsTableProps) {
  const [allItems, setAllItems] = useState(items)
  const [cursor, setCursor] = useState(initialCursor ?? null)
  const [loading, setLoading] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('timestamp')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Reset when server re-renders (auto-refresh or filter change)
  useEffect(() => {
    setAllItems(items)
    setCursor(initialCursor ?? null)
  }, [items, initialCursor])

  async function loadMore() {
    if (!cursor || loading) return
    setLoading(true)
    try {
      const params = new URLSearchParams({ date, risk, cursor, limit: '50' })
      const res = await fetch(`/api/transactions?${params}`)
      const data = await res.json()
      setAllItems(prev => [...prev, ...(data.items ?? [])])
      setCursor(data.nextCursor ?? null)
    } finally {
      setLoading(false)
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = [...allItems].sort((a, b) => {
    const va = a[sortKey] as string | number
    const vb = b[sortKey] as string | number
    return sortDir === 'asc'
      ? (va < vb ? -1 : va > vb ? 1 : 0)
      : (va > vb ? -1 : va < vb ? 1 : 0)
  })

  if (allItems.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState title="No transactions found" description="Try adjusting the date or risk filter." />
        </CardContent>
      </Card>
    )
  }

  function SortHead({ label, field }: { label: string; field: SortKey }) {
    return (
      <TableHead
        className="cursor-pointer select-none hover:text-[var(--foreground)]"
        onClick={() => toggleSort(field)}
      >
        <span className="flex items-center gap-1">
          {label}
          <ArrowUpDown className="h-3 w-3 opacity-50" />
        </span>
      </TableHead>
    )
  }

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead label="Time" field="timestamp" />
                <TableHead>TX ID</TableHead>
                <TableHead>Account</TableHead>
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
                    {formatTime(tx.timestamp)}
                  </TableCell>
                  <TableCell>
                    <Link href={`/transaction/${tx.transactionId}`} className="font-mono text-xs text-blue-500 hover:text-blue-400">
                      {tx.transactionId.slice(0, 16)}…
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link href={`/account/${tx.accountId}`} className="font-mono text-xs text-blue-500 hover:text-blue-400">
                      {tx.accountId}
                    </Link>
                  </TableCell>
                  <TableCell className="font-semibold">{formatMYR(tx.amountMYR)}</TableCell>
                  <TableCell className="max-w-[140px] truncate">{tx.merchantName ?? '—'}</TableCell>
                  <TableCell>
                    <span className="text-xs">{tx.transactionType ?? '—'}</span>
                  </TableCell>
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

      {cursor && (
        <div className="flex items-center justify-between text-sm text-[var(--muted-foreground)]">
          <span>{allItems.length} transactions loaded</span>
          <button
            onClick={loadMore}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium bg-[var(--card)] border border-[var(--border)] hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
          >
            {loading ? (
              <><Loader2 className="h-4 w-4 animate-spin" /> Loading…</>
            ) : (
              'Load more'
            )}
          </button>
        </div>
      )}

      {!cursor && allItems.length > 0 && (
        <p className="text-center text-xs text-[var(--muted-foreground)] py-2">
          All {allItems.length} transactions loaded
        </p>
      )}
    </div>
  )
}
