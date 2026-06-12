'use client'

import { RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { RiskBadge } from '@/components/shared/RiskBadge'
import type { DlqMessage, RiskLevel } from '@/lib/types'
import type { RowState } from './useFailedTransactions'

interface Props {
  msg: DlqMessage
  state: RowState | undefined
  onAction: (action: 'redrive' | 'delete', msg: DlqMessage) => void
}

export function FailedTransactionRow({ msg, state, onAction }: Props) {
  const tx = msg.body
  return (
    <tr
      className={[
        'border-b border-[var(--border)] transition-colors',
        state?.done ? 'opacity-40' : 'hover:bg-[var(--muted)]/30',
      ].join(' ')}
    >
      <td className="px-4 py-3 text-[var(--muted-foreground)] whitespace-nowrap">
        {msg.failedAt ? new Date(msg.failedAt).toLocaleString() : '—'}
      </td>

      <td className="px-4 py-3 font-mono text-xs">
        <span title={msg.transactionId}>{msg.transactionId.slice(0, 8)}…</span>
      </td>

      <td className="px-4 py-3">
        {tx?.accountId ?? <span className="text-[var(--muted-foreground)]">—</span>}
      </td>

      <td className="px-4 py-3 text-right tabular-nums">
        {tx?.amountMYR != null
          ? tx.amountMYR.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : '—'}
      </td>

      <td className="px-4 py-3">
        {tx?.riskLevel ? (
          <RiskBadge level={tx.riskLevel as RiskLevel} score={tx.riskScore} />
        ) : (
          <span className="text-[var(--muted-foreground)]">—</span>
        )}
      </td>

      <td className="px-4 py-3 text-center">
        <span
          className={[
            'inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold',
            msg.receiveCount >= 3 ? 'bg-red-900/40 text-red-400' : 'bg-orange-900/30 text-orange-400',
          ].join(' ')}
        >
          {msg.receiveCount}
        </span>
      </td>

      <td className="px-4 py-3">
        <div className="flex items-center justify-end gap-2">
          {state?.error && <span className="text-xs text-red-400">{state.error}</span>}
          {state?.done ? (
            <span className="text-xs text-green-400 font-medium">Done</span>
          ) : (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs gap-1"
                disabled={state?.loading}
                onClick={() => onAction('redrive', msg)}
                title="Send back to main queue for reprocessing"
              >
                <RotateCcw className="h-3 w-3" />
                Redrive
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-xs gap-1 text-red-400 hover:text-red-300 hover:border-red-700"
                disabled={state?.loading}
                onClick={() => onAction('delete', msg)}
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
}
