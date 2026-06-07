export const dynamic = 'force-dynamic'

import { AppShell } from '@/components/layout/AppShell'
import { Breadcrumbs } from '@/components/layout/Breadcrumbs'
import { Card, CardContent } from '@/components/ui/card'
import { LiveAuditTable } from '@/components/live-audit/LiveAuditTable'
import { Activity } from 'lucide-react'

export default function LiveAuditPage() {
  return (
    <AppShell>
      <Breadcrumbs />
      <div className="space-y-6">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-[var(--foreground)]">Live Audit</h1>
            <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
              Last 20 processed transactions — polls DynamoDB every 5 seconds.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full bg-green-900/30 border border-green-700/40 px-3 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
            </span>
            <span className="text-xs font-medium text-green-400">Live</span>
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center gap-2">
              <Activity className="h-4 w-4 text-blue-400" />
              <span className="text-sm font-semibold text-[var(--foreground)]">Recent Transactions</span>
            </div>
            <div className="p-5">
              <LiveAuditTable />
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  )
}
