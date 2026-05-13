'use client'

import { Download } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import type { Transaction } from '@/lib/types'

const CSV_HEADERS: (keyof Transaction)[] = [
  'transactionId', 'timestamp', 'datePartition', 'accountId', 'customerName',
  'customerTier', 'cardType', 'cardLast4', 'amount', 'currency', 'amountMYR',
  'transactionType', 'channel', 'merchantName', 'merchantCategory',
  'merchantCity', 'merchantCountry', 'riskScore', 'riskLevel',
  'isFlagged', 'flagReason', 'fraudScenario',
]

interface ExportButtonProps {
  items: Transaction[]
  filename?: string
}

export function ExportButton({ items, filename = 'transactions.csv' }: ExportButtonProps) {
  function handleExport() {
    const header = CSV_HEADERS.join(',')
    const rows = items.map((tx) =>
      CSV_HEADERS.map((k) => {
        const v = tx[k]
        if (v === undefined || v === null) return ''
        const s = Array.isArray(v) ? v.join(';') : String(v)
        return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
      }).join(',')
    )
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`Exported ${items.length} transactions`)
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExport}>
      <Download className="h-3.5 w-3.5 mr-1.5" />
      Export CSV
    </Button>
  )
}
