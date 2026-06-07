'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { RefreshCw, AlertTriangle } from 'lucide-react'
import { RiskBadge } from '@/components/shared/RiskBadge'
import type { Transaction } from '@/lib/types'
import { formatTimestamp } from '@/lib/utils'

interface LiveAuditData {
  transactions: Transaction[]
  error?: string
}

const INTERVAL_MS = 5000

export function LiveAuditTable() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)
  const [countdown, setCountdown] = useState(INTERVAL_MS / 1000)
  const isFetchingRef = useRef(false)

  const fetchTransactions = useCallback(async (isBackground = false) => {
    if (isFetchingRef.current) return
    isFetchingRef.current = true
    if (!isBackground) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const res = await fetch('/api/live-audit', { cache: 'no-store' })
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`)
      }
      const json: LiveAuditData = await res.json()
      if (json.error) throw new Error(json.error)
      setTransactions(json.transactions)
      setLastRefreshed(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load transactions')
    } finally {
      setLoading(false)
      setRefreshing(false)
      isFetchingRef.current = false
    }
  }, [])

  useEffect(() => {
    fetchTransactions(false)
  }, [fetchTransactions])

  useEffect(() => {
    let startTime = Date.now()

    const tick = setInterval(() => {
      const elapsed = Date.now() - startTime
      const remaining = Math.max(0, Math.ceil((INTERVAL_MS - elapsed) / 1000))
      setCountdown(remaining)

      if (elapsed >= INTERVAL_MS) {
        fetchTransactions(true)
        startTime = Date.now()
        setCountdown(INTERVAL_MS / 1000)
      }
    }, 1000)

    return () => clearInterval(tick)
  }, [fetchTransactions])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--muted-foreground)] text-sm">
        <RefreshCw className="h-4 w-4 animate-spin mr-2" />
        Loading transactions…
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Status bar */}
      <div className="flex items-center justify-between text-xs text-[var(--muted-foreground)]">
        <span>
          {transactions.length} transaction{transactions.length !== 1 ? 's' : ''}
          {lastRefreshed && (
            <span className="ml-2 opacity-60">
              · last updated {lastRefreshed.toLocaleTimeString('en-MY', { timeZone: 'Asia/Kuala_Lumpur' })}
            </span>
          )}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Refreshing…' : `Refreshes in ${countdown}s`}
        </span>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-700 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {transactions.length === 0 && !error ? (
        <div className="flex items-center justify-center h-32 text-[var(--muted-foreground)] text-sm">
          No transactions in the last 7 days.
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/40">
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)] text-xs uppercase tracking-wide">
                  Transaction ID
                </th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)] text-xs uppercase tracking-wide">
                  Account
                </th>
                <th className="px-4 py-3 text-right font-semibold text-[var(--muted-foreground)] text-xs uppercase tracking-wide">
                  Amount
                </th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)] text-xs uppercase tracking-wide">
                  Currency
                </th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)] text-xs uppercase tracking-wide">
                  Risk / Status
                </th>
                <th className="px-4 py-3 text-left font-semibold text-[var(--muted-foreground)] text-xs uppercase tracking-wide">
                  Processed At
                </th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx, i) => (
                <tr
                  key={tx.transactionId}
                  className={`border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]/30 transition-colors ${
                    i % 2 === 0 ? '' : 'bg-[var(--muted)]/10'
                  }`}
                >
                  <td className="px-4 py-3 font-mono text-xs">
                    <Link
                      href={`/transaction/${tx.transactionId}`}
                      className="text-blue-400 hover:text-blue-300 hover:underline"
                    >
                      {tx.transactionId.slice(0, 8)}…
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-[var(--muted-foreground)]">
                    <Link
                      href={`/account/${tx.accountId}`}
                      className="hover:text-[var(--foreground)] transition-colors"
                    >
                      {tx.accountId}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums">
                    {tx.amount.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </td>
                  <td className="px-4 py-3 text-[var(--muted-foreground)]">{tx.currency}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <RiskBadge level={tx.riskLevel} score={tx.riskScore} size="sm" />
                      {tx.isFlagged && (
                        <span className="text-[10px] font-semibold text-red-400 uppercase tracking-wide">
                          Flagged
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--muted-foreground)]">
                    {tx.processedAt ?? tx.timestamp
                      ? formatTimestamp(tx.processedAt ?? tx.timestamp!)
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
