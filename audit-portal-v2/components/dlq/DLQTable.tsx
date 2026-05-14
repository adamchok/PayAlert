'use client'

import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, RotateCcw, Trash2, AlertTriangle, Inbox } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { RiskBadge } from '@/components/shared/RiskBadge'
import type { DlqMessage, RiskLevel } from '@/lib/types'

interface DLQResponse {
  queueDepth: number
  inFlight: number
  messages: DlqMessage[]
  error?: string
}

interface RowState {
  loading: boolean
  done: boolean
  error: string | null
}

export function DLQTable() {
  const [data, setData] = useState<DLQResponse | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [rowState, setRowState] = useState<Record<string, RowState>>({})

  const fetchMessages = useCallback(async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await fetch('/api/dlq', { cache: 'no-store' })
      const json: DLQResponse = await res.json()
      if (json.error) throw new Error(json.error)
      setData(json)
      setRowState({})
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : 'Failed to load DLQ')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchMessages() }, [fetchMessages])

  async function handleAction(
    action: 'redrive' | 'delete',
    msg: DlqMessage
  ) {
    setRowState(s => ({ ...s, [msg.messageId]: { loading: true, done: false, error: null } }))
    try {
      const res = await fetch('/api/dlq', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          receiptHandle: msg.receiptHandle,
          rawBody: msg.rawBody,
        }),
      })
      const json = await res.json()
      if (!json.ok) throw new Error(json.error ?? 'Unknown error')
      setRowState(s => ({ ...s, [msg.messageId]: { loading: false, done: true, error: null } }))
      // Remove from local list after short delay so user sees "Done"
      setTimeout(() => {
        setData(prev =>
          prev
            ? { ...prev, messages: prev.messages.filter(m => m.messageId !== msg.messageId) }
            : prev
        )
      }, 800)
    } catch (e) {
      setRowState(s => ({
        ...s,
        [msg.messageId]: {
          loading: false,
          done: false,
          error: e instanceof Error ? e.message : 'Failed',
        },
      }))
    }
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 flex items-center justify-center gap-3 text-[var(--muted-foreground)]">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading DLQ messages…</span>
        </CardContent>
      </Card>
    )
  }

  if (fetchError) {
    return (
      <Card>
        <CardContent className="p-8 flex items-center justify-center gap-3 text-red-400">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm">{fetchError}</span>
        </CardContent>
      </Card>
    )
  }

  const messages = data?.messages ?? []

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base font-semibold">
          Failed Messages
          {messages.length > 0 && (
            <Badge variant="critical" className="ml-2 text-xs">
              {messages.length} loaded
            </Badge>
          )}
        </CardTitle>
        <button
          onClick={fetchMessages}
          className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </CardHeader>

      <CardContent className="p-0">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-[var(--muted-foreground)]">
            <Inbox className="h-10 w-10 opacity-30" />
            <p className="text-sm font-medium">No messages in the DLQ</p>
            <p className="text-xs opacity-60">All transactions are processing normally.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] text-xs text-[var(--muted-foreground)] uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-semibold">Sent At</th>
                  <th className="text-left px-4 py-3 font-semibold">Transaction ID</th>
                  <th className="text-left px-4 py-3 font-semibold">Account</th>
                  <th className="text-right px-4 py-3 font-semibold">Amount (MYR)</th>
                  <th className="text-left px-4 py-3 font-semibold">Risk</th>
                  <th className="text-center px-4 py-3 font-semibold">Tries</th>
                  <th className="text-right px-4 py-3 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {messages.map((msg) => {
                  const rs = rowState[msg.messageId]
                  const tx = msg.body
                  return (
                    <tr
                      key={msg.messageId}
                      className={[
                        'border-b border-[var(--border)] transition-colors',
                        rs?.done ? 'opacity-40' : 'hover:bg-[var(--muted)]/30',
                      ].join(' ')}
                    >
                      {/* Sent At */}
                      <td className="px-4 py-3 text-[var(--muted-foreground)] whitespace-nowrap">
                        {msg.sentAt
                          ? new Date(msg.sentAt).toLocaleString()
                          : '—'}
                      </td>

                      {/* Transaction ID */}
                      <td className="px-4 py-3 font-mono text-xs">
                        {tx?.transactionId ? (
                          <span title={tx.transactionId}>
                            {tx.transactionId.slice(0, 8)}…
                          </span>
                        ) : (
                          <span className="text-[var(--muted-foreground)]" title={msg.messageId}>
                            {msg.messageId.slice(0, 8)}…
                          </span>
                        )}
                      </td>

                      {/* Account */}
                      <td className="px-4 py-3">
                        {tx?.accountId ?? (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>

                      {/* Amount */}
                      <td className="px-4 py-3 text-right tabular-nums">
                        {tx?.amountMYR != null
                          ? tx.amountMYR.toLocaleString('en-MY', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })
                          : '—'}
                      </td>

                      {/* Risk */}
                      <td className="px-4 py-3">
                        {tx?.riskLevel ? (
                          <RiskBadge level={tx.riskLevel as RiskLevel} score={tx.riskScore} />
                        ) : (
                          <span className="text-[var(--muted-foreground)]">—</span>
                        )}
                      </td>

                      {/* Tries */}
                      <td className="px-4 py-3 text-center">
                        <span
                          className={[
                            'inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold',
                            msg.receiveCount >= 3
                              ? 'bg-red-900/40 text-red-400'
                              : 'bg-orange-900/30 text-orange-400',
                          ].join(' ')}
                        >
                          {msg.receiveCount}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-2">
                          {rs?.error && (
                            <span className="text-xs text-red-400">{rs.error}</span>
                          )}
                          {rs?.done ? (
                            <span className="text-xs text-green-400 font-medium">Done</span>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs gap-1"
                                disabled={rs?.loading}
                                onClick={() => handleAction('redrive', msg)}
                                title="Send back to main queue for reprocessing"
                              >
                                <RotateCcw className="h-3 w-3" />
                                Redrive
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs gap-1 text-red-400 hover:text-red-300 hover:border-red-700"
                                disabled={rs?.loading}
                                onClick={() => handleAction('delete', msg)}
                                title="Permanently delete this message"
                              >
                                <Trash2 className="h-3 w-3" />
                                Delete
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {messages.length > 0 && (
          <p className="text-xs text-[var(--muted-foreground)] px-4 py-3 border-t border-[var(--border)]">
            Messages are locked for 5 minutes after loading. Refresh to load the next batch.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
