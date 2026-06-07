'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronRight, Home } from 'lucide-react'

const SEGMENT_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  transactions: 'Transactions',
  'live-audit': 'Live Audit',
  account: 'Account',
  transaction: 'Transaction',
  dlq: 'Dead Letter Queue',
  api: 'API',
}

// Path prefixes with no standalone page — render as text, not links
const NON_NAVIGABLE = new Set(['account', 'transaction'])

export function Breadcrumbs() {
  const pathname = usePathname()
  const segments = pathname.split('/').filter(Boolean)

  if (segments.length === 0) return null

  const crumbs = segments.map((seg, i) => {
    const href = '/' + segments.slice(0, i + 1).join('/')
    const label = SEGMENT_LABELS[seg] ?? seg
    const isLast = i === segments.length - 1
    return { href, label, isLast, seg }
  })

  return (
    <nav className="flex items-center gap-1 text-sm text-[var(--muted-foreground)] mb-4" aria-label="Breadcrumb">
      <Link href="/dashboard" className="hover:text-[var(--foreground)] transition-colors">
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.map(({ href, label, isLast, seg }) => (
        <span key={href} className="flex items-center gap-1">
          <ChevronRight className="h-3 w-3 opacity-50" />
          {isLast || NON_NAVIGABLE.has(seg) ? (
            <span className="text-[var(--foreground)] font-medium">{label}</span>
          ) : (
            <Link href={href} className="hover:text-[var(--foreground)] transition-colors">{label}</Link>
          )}
        </span>
      ))}
    </nav>
  )
}
