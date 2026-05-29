'use client'

import { RefreshCw, AlertTriangle, Inbox } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useDLQMessages } from './useDLQMessages'
import { DLQMessageRow } from './DLQMessageRow'

export function DLQTable() {
  const { data, fetchError, loading, rowState, fetchMessages, handleAction } = useDLQMessages()
  const messages = data?.messages ?? []

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
                {messages.map((msg) => (
                  <DLQMessageRow
                    key={msg.messageId}
                    msg={msg}
                    state={rowState[msg.messageId]}
                    onAction={handleAction}
                  />
                ))}
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
